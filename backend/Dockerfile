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

# Heap is sized as a percentage of the container's cgroup memory limit rather
# than a fixed -Xmx. The previous -Xmx200m was pinned while the Deployment's
# limit was 800Mi, so the JVM OOMed ("Terminating due to
# java.lang.OutOfMemoryError: Java heap space", via ExitOnOutOfMemoryError)
# with most of the pod's memory unused. Percentage sizing tracks whatever
# limit openshift.deploy.yml sets instead of drifting out of sync again.
#
# 60% leaves ~40% for the non-heap footprint this app actually uses:
# Metaspace (capped at 200m below), JIT code cache, ~50 thread stacks, and
# the direct ByteBuffers Undertow allocates for I/O. That overhead is roughly
# fixed at ~250-300MB regardless of heap size, so at the 1Gi limit the prod
# namespace quota allows it is a large fraction of the container — hence 60
# rather than a more typical 70-75. Raising this risks the kernel OOM-killing
# the container instead, a harder failure than a heap OOM because it produces
# no dump and no Java stack.
#
# HeapDumpOnOutOfMemoryError writes to /temp (an emptyDir; the root FS is
# read-only). The dump is written before ExitOnOutOfMemoryError terminates
# the JVM. Keep the Deployment's ephemeral-storage limit above the max heap
# size or the dump will fill the volume and get the pod evicted.
# Log timestamps are NOT pinned here. The timezone comes from the TZ env var
# set on the Deployment (see openshift.deploy.yml), so it can be changed per
# environment without rebuilding this image. The JVM resolves a named TZ from
# the tzdb bundled inside the JDK, so it works on this Alpine base even though
# the OS has no tzdata package. Do not add -Duser.timezone: it would override
# TZ and make the deployment parameter silently ineffective.
ENTRYPOINT ["java","-Duser.name=FSP-API","-XX:InitialRAMPercentage=30","-XX:MaxRAMPercentage=60","-XX:TieredStopAtLevel=1","-XX:+UseParallelGC","-XX:MinHeapFreeRatio=20","-XX:MaxHeapFreeRatio=40","-XX:GCTimeRatio=4","-XX:AdaptiveSizePolicyWeight=90","-XX:MaxMetaspaceSize=200m","-XX:ParallelGCThreads=2","-Djava.util.concurrent.ForkJoinPool.common.parallelism=8","-XX:CICompilerCount=2","-XX:+HeapDumpOnOutOfMemoryError","-XX:HeapDumpPath=/temp","-XX:+ExitOnOutOfMemoryError","-Djava.security.egd=file:/dev/./urandom","-cp","app:app/lib/*","ca.bc.gov.nrs.fsp.api.FspApiResourceApplication"]
