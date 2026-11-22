# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).

FROM maven:3.9.16-eclipse-temurin-25-noble AS build
WORKDIR /src
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
# Tests run in CI before the image is built.
RUN mvn -B -q -DskipTests package

# Shell-less Java 25 runtime with CA certificates, running as a non-root user.
FROM gcr.io/distroless/java25-debian13:nonroot
COPY --from=build /src/target/ledger-service.jar /app/ledger-service.jar
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
# Heap sized from the container memory limit; serial GC and C1-first compilation favour fast cold
# starts on a scale-to-zero host.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/ledger-service.jar"]
