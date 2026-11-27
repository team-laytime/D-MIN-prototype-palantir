"""Capture separate 72-hour case snapshots in a bounded local batch."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from fcntl import LOCK_EX, LOCK_NB, flock
import json
from pathlib import Path
from subprocess import run


def capture(day, args):
    snapshot = args.output / f'{day}.json'
    log = args.output / f'{day}.log'
    command = [
        'node', str(Path(__file__).with_name('capture_precedent_case.mjs').resolve()),
        str(args.dataset.resolve()), day, str(snapshot.resolve()), str(args.engine.resolve()), args.python,
    ]
    if not args.prototype_defaults:
        command.append('--screening')
    with log.open('a') as stream:
        try:
            flock(stream, LOCK_EX | LOCK_NB)
        except BlockingIOError:
            return day, 'capture already running', False
        if snapshot.is_file():
            existing = json.loads(snapshot.read_text())
            return day, existing['status'], existing['status'] != 'incomplete'
        result = run(command, stdout=stream, stderr=stream, check=False)
    if result.returncode or not snapshot.is_file():
        return day, f'capture failed; see {log}', False
    status = json.loads(snapshot.read_text())['status']
    return day, status, status != 'incomplete'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('days', nargs='+', type=date.fromisoformat)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--python', default='python3')
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--prototype-defaults', action='store_true')
    args = parser.parse_args()
    if len(args.days) != len(set(args.days)) or args.jobs < 1:
        parser.error('Provide unique dates and at least one worker')
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    statuses = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(capture, day.isoformat(), args) for day in args.days]
        for future in as_completed(futures):
            day, status, ok = future.result()
            statuses.append(ok)
            print(day, status, flush=True)
    raise SystemExit(0 if all(statuses) else 1)


if __name__ == '__main__':
    main()
