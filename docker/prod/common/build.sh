docker build -t portfolio-builder -f Dockerfile.builder ../../..
docker build -t portfolio-http-server -f Dockerfile.http-server ../../..
docker-compose build && docker-compose up
