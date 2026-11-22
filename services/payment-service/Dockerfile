# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).

FROM golang:1.27.4-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/payment-service .

# Static, shell-less runtime image with CA certificates, running as a non-root user.
FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/payment-service /payment-service
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/payment-service"]
