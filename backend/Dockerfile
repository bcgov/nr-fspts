FROM maven:3.9.9-amazoncorretto-21-alpine AS build
WORKDIR /workspace/app

COPY pom.xml .
COPY src src
RUN mvn package -DskipTests
RUN mkdir -p target/dependency && (cd target/dependency; jar -xf ../*.jar)

FROM eclipse-temurin:21.0.9_10-jdk-alpine-3.23

RUN adduser -D -s /bin/sh spring
RUN mkdir -p /logs
RUN chown -R spring:spring /logs
RUN chmod 755 /logs
USER spring
VOLUME /tmp
ARG DEPENDENCY=/workspace/app/target/dependency
COPY --from=build ${DEPENDENCY}/BOOT-INF/lib /app/lib
COPY --from=build ${DEPENDENCY}/META-INF /app/META-INF
COPY --from=build ${DEPENDENCY}/BOOT-INF/classes /app

# OpenShift ignores HEALTHCHECK in favour of the Deployment's
# livenessProbe/readinessProbe, but Trivy (DS-0026) and `docker run` outside
# K8s both expect one. We hit Spring Boot Actuator's /health endpoint via
# Alpine's built-in BusyBox wget (no curl in eclipse-temurin alpine).
# --start-period gives Spring a generous window before failed checks count
# against the container's health state.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["java","-Duser.name=FSP-API","-Xms100m","-Xmx200m","-XX:TieredStopAtLevel=1","-XX:+UseParallelGC","-XX:MinHeapFreeRatio=20","-XX:MaxHeapFreeRatio=40","-XX:GCTimeRatio=4","-XX:AdaptiveSizePolicyWeight=90","-XX:MaxMetaspaceSize=200m","-XX:ParallelGCThreads=2","-Djava.util.concurrent.ForkJoinPool.common.parallelism=8","-XX:CICompilerCount=2","-XX:+ExitOnOutOfMemoryError","-Djava.security.egd=file:/dev/./urandom","-cp","app:app/lib/*","ca.bc.gov.nrs.fsp.api.FspApiResourceApplication"]
