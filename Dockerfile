# 화면을 빌드해 nginx로 띄운다. 수업 EKS p2-1의 dmin-front(포트 8080)로 배포된다.
# 빌드 결과는 CPU와 상관없는 정적 파일이라, 빌드 단계는 runner의 CPU 그대로(에뮬레이션 없이) 돌린다.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
