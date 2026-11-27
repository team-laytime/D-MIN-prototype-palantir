"""Invoke the team's preprocessing, solver and risk handlers over JSON lines."""

import json
import sys

from berth_prep.api import RatesRequest, compute as compute_rates
from berth_risk.api import RisksRequest, compute as compute_risks
from berth_sim.api.service import solve
from fastapi.encoders import jsonable_encoder


for line in sys.stdin:
    try:
        call = json.loads(line)
        if 'prep' in call:
            result = compute_rates(RatesRequest.model_validate(call['prep']))
        else:
            request = call['request']
            status, response = solve(request)
            result = {'status': status, 'response': response, 'risks': None, 'risk_error': None}
            if status == 200 and response.get('plan') is not None:
                try:
                    result['risks'] = compute_risks(RisksRequest.model_validate({
                        'plan_request': request,
                        'plan_response': response,
                        'rates': None,
                    }))
                except Exception as error:
                    result['risk_error'] = str(error)
        print(json.dumps(jsonable_encoder(result), ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), flush=True)
