FROM caddy:2-alpine

COPY build/ /usr/share/caddy

EXPOSE 80
