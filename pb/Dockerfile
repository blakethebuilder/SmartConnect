FROM alpine:latest
# ghcr.io/pocketbase/pocketbase anonymous pulls are DENIED — build from the GitHub release zip instead.
ENV TZ=Africa/Johannesburg
RUN apk add --no-cache ca-certificates wget unzip tzdata \
 && wget -q https://github.com/pocketbase/pocketbase/releases/download/v0.39.0/pocketbase_0.39.0_linux_amd64.zip -O /tmp/pb.zip \
 && unzip -q /tmp/pb.zip -d /pb \
 && chmod +x /pb/pocketbase \
 && rm /tmp/pb.zip
WORKDIR /pb
COPY entrypoint.sh /pb/entrypoint.sh
# ponytail: migrations baked into image — hermes-side bind mounts don't resolve on the docker host
COPY pb_migrations/ /pb/pb_migrations/
ENTRYPOINT ["/bin/sh", "/pb/entrypoint.sh"]
