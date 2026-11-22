# Design

## Context

`services/ledger-service/` holds only a README and its OpenSpec folder. The platform layer already provides:
- the `ledger` schema, owned by the `ledger_service` login role (`search_path = ledger`), which cannot reach the other service schemas;
- a local-only role password in `supabase/seed.sql`;
- asymmetric Supabase signing keys, published through JWKS.

payment-service (Go) set the skeleton pattern and runs on Vercel with the Container runtime. That deploy confirmed:
- the Root Directory subfolder works;
- the Supavisor session pooler accepts a service role (`<role>.<project-ref>`).

This change follows the same pattern in Java 25 with Vert.x 5 (ADR 0006).

The local machine has JDK 25.0.2 at `C:\Program Files\Java\jdk-25.0.2` and Maven 3.9.6 at `C:\Program Files\Java\apache-maven-3.9.6`, but no working Docker.

Everything in the Appendix was prototyped on a temporary branch. The `ledger-service` workflow passed on its first run:
- 18 tests, including the 6 integration tests against local Supabase;
- `openspec validate` and the oasdiff check;
- the Docker build;
- the container smoke test (startup to listening in about 0.5 seconds after migrations).

## Goals / Non-Goals

**Goals:**
- A deployable, tested Vert.x skeleton that validates Supabase tokens and owns its schema migrations.
- The ledger's two storage invariants enforced by the database from day one: balanced entries and an append-only journal.

**Non-Goals:**
- Posting logic, reports, per-user opening entries, sandbox reset, outbox and events, guest restrictions, the site fault flag and telemetry: later roadmap steps.
- Any hosted action.

## Decisions

### D1. Threading model
- **HTTP and JWT:** the HTTP server, routing, JWT checks and JWKS fetches all run on the Vert.x event loop, using only non-blocking APIs (`WebClient`, `JWTAuth`).
- **Migrations:** Flyway uses blocking JDBC. It runs on the `main` thread **before** Vert.x is created, so no event loop exists yet.
- **Later database work:** step 5 will add request-time database access through `executeBlocking` or worker verticles, as ADR 0006 requires. This change has none.

### D2. JWT validation with Vert.x `JWTAuth`
`TokenVerifier` builds a `JWTAuth` from the JWKS. It keeps only public keys whose `alg` is ES256 or RS256 and whose `kty` is EC or RSA. Symmetric and private keys are ignored, and a JWKS with no usable key is an error.

Checks, in order:
1. **Header:** the `alg` is read before verification. Anything other than ES256 or RS256 fails, so `none` and HS256 never reach `JWTAuth`.
2. **Claims:** `JWTOptions` sets the issuer, the audience `authenticated` and a 30-second leeway.
3. **Required claims:** after verification, `exp` must be a number and `sub` a non-empty string.

The current `JWTAuth` sits in an `AtomicReference`, so a key refresh swaps it atomically. Handlers receive only `Identity(userId, anonymous)`.

Alternatives considered:
- **Nimbus JOSE+JWT.** Rejected: `docs/security/auth.md` names Vert.x `JWTAuth`, and it avoids a second JWT stack.
- **`OAuth2Auth` with JWKS discovery.** Rejected as heavier, and built for client flows.

### D3. JWKS loading
`JwksLoader` fetches `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` with the Vert.x `WebClient`:
- 5-second connect and response timeout;
- once at startup (awaited, but a failure does not stop startup), then hourly;
- after a rejected token, at most once every 5 minutes. That covers key rotation without letting bad tokens trigger a fetch storm.

### D4. `DATABASE_URL` and Flyway
- **URL format:** every service takes the same `postgres://user:password@host:port/db?params` URL. `DatabaseUrl` converts it to a JDBC URL plus a separate user and password, so the password never appears in a JDBC URL or in `toString()`.
- **Flyway 13 configuration:**
  - `schemas("ledger")`, `defaultSchema("ledger")` and `createSchemas(false)`: the platform layer owns schema creation;
  - migrations from `classpath:db/migration`;
  - a 10-second connect timeout and a 30-second statement timeout.
- **Concurrency:** Flyway takes a Postgres advisory lock, so concurrent cold starts are safe, and an up-to-date schema is a no-op. The hosted URL must use the session pooler on port 5432, the same as payment-service.
- **Shaded jar:** the shade plugin's `ServicesResourceTransformer` keeps Flyway's ServiceLoader registrations, without which PostgreSQL support is lost. The overlapping-resource warnings shade prints are `META-INF` license and manifest files, which are harmless.

### D5. Migration V1: chart of accounts and journal
- **`accounts`:** seeded with ADR 0006's chart: 1000 Cash, 1100 Settlement Receivable, 2000 Customer Funds, 4000 Fee Revenue, 5000 Processing Expense. Each account has a type (asset, liability, equity, revenue, expense).
- **`journal_entries`:**
  - columns: `user_id`, `idempotency_key` (unique per user), `kind` (`opening`, `payment`, `reversal`), `payment_id`, `currency` (`^[A-Z]{3}$`), `posted_at`;
  - `reverses_entry_id` is set exactly when `kind = 'reversal'`.
- **`journal_lines`:** `(entry_id, line_no)` key, an account reference, and `debit_minor`/`credit_minor` as `bigint >= 0`, exactly one of them positive.
- **Balance rule:** two `deferrable initially deferred` constraint triggers, on entries and on lines, call `assert_entry_balances()` at commit. It raises `check_violation` (SQLSTATE 23514) unless the entry has two or more lines and equal debit and credit sums. An entry and its lines must therefore be inserted in one transaction.
- **Append-only:** `before update` triggers raise `restrict_violation` (23001). Sandbox reset (ADR 0011) deletes entries, and lines follow by `on delete cascade`.
- **Where the recipient email lives:** not in this schema. It belongs to the notification schema (ADR 0014).

### D6. Planned endpoints answer 501 behind authentication
The five endpoints exist so the authentication, the contract and the smoke test cover real routes. They write nothing. The contract adds `501` responses only, and oasdiff reports "no breaking changes".

### D7. Container image
- **Build stage:** `maven:3.9.16-eclipse-temurin-25-noble` runs `dependency:go-offline` (a cached layer), then `package -DskipTests`. Tests run in CI before the image build.
- **Runtime stage:** `gcr.io/distroless/java25-debian13:nonroot` (no shell, CA certificates included), running as a non-root user with `PORT=8080`.
- **JVM flags:**
  - `-XX:MaxRAMPercentage=75` sizes the heap from the container limit;
  - `-XX:+UseSerialGC` and `-XX:TieredStopAtLevel=1` favour fast cold starts on a scale-to-zero host;
  - `-XX:+ExitOnOutOfMemoryError` restarts the container rather than leaving it unhealthy.

### D8. Logging
`java.util.logging` is reset at startup and given one `ConsoleHandler` on stdout with `JsonLogFormatter`, which writes one JSON object per line. Vert.x and Flyway log through it too. Requests log only method, route, status and duration: no headers, tokens, query strings or user ids.

### D9. Tests and CI
- **Unit tests:** no network or database:
  - `HttpApiTest`: routes, 401 with `WWW-Authenticate`, 501, 404 and 405, and the rejection callback;
  - `TokenVerifierTest`: locally generated EC and RSA keys;
  - `DatabaseUrlTest`.
- **`LocalStackTest`:** skips itself unless three `LEDGER_TEST_*` variables are set. It runs in the same `mvn verify`. CI then checks the surefire report for 6 tests, 0 skipped and 0 failures, so the integration tests can never pass by being skipped.
- **CI workflow `ledger-service`:** uses setup-java (Temurin 25, Maven cache) and runs:
  - `openspec validate`;
  - oasdiff through its Docker image (`tufin/oasdiff:v1.39.0`), because this job has no Go;
  - the local Supabase stack, then `mvn verify`;
  - the Docker build and the container smoke test.
- **Dependabot:** watches `maven` and `docker` in the service folder.
- **Enforcer rule:** requires JDK `[25,26)` and Maven `3.9.6` or newer.
- **Compiler:** runs with `-Xlint:all,-classfile,-processing -Werror`. The two exclusions silence warnings about Vert.x's optional code-generation annotations, which are not on the classpath.

### D10. Dependencies and quotas
| Artifact | Version | License | Why |
|---|---|---|---|
| `io.vertx:vertx-web` (with `vertx-core`), `vertx-web-client`, `vertx-auth-jwt` via `vertx-stack-depchain` | 5.2.3 | Apache-2.0 (dual EPL-2.0) | HTTP server, router, JWKS client, JWT validation |
| `org.flywaydb:flyway-core`, `flyway-database-postgresql` | 13.13.0 | Apache-2.0 | Migrations in the service's own schema |
| `org.postgresql:postgresql` | 42.7.14 | BSD-2-Clause | JDBC driver for Flyway and the integration tests |
| `org.junit.jupiter:junit-jupiter` (via `junit-bom`) | 5.14.4 | EPL-2.0, **test scope only** | Unit and integration tests; not in the jar or the image |

Build plugins: enforcer 3.7.0, compiler 3.16.0, surefire 3.6.1 and shade 3.6.2 (Apache-2.0). Apache-2.0 and BSD-2-Clause are permissive and compatible with the MIT-licensed repository. EPL-2.0 applies only to the test runner, which is never shipped.

Free-tier usage:
- **Vercel Hobby:** one more project.
- **Database:** one connection per cold start for migrations; none while serving.
- **JWKS:** about one fetch per hour per warm container.
- **Image size:** about 13 MB for the jar on top of the distroless Java base, well within the registry limits.

## Risks / Trade-offs

- [JVM cold starts are slower than Go] → Serial GC, C1-only compilation and a small dependency set keep startup short (about 1 second including migrations in CI). Revisit with CDS or AOT cache if latency dashboards show it.
- [Deferred triggers mean the balance check fails at commit, not at insert] → Step 5 must insert an entry and its lines in one transaction. The integration tests show both the rejection and the SQLSTATE.
- [Rejected tokens can trigger JWKS fetches] → Limited to one fetch every 5 minutes.
- [Root files touched by a service change] → `.github/workflows/ledger-service.yml` and two `dependabot.yml` entries, the same exception as payment-service.
- [Local machine without Docker] → Unit tests, the jar build and `openspec validate` run locally. CI is authoritative for the integration tests, the image and the smoke test.

## Appendix

Copy every file exactly. Paths are relative to the repository root.

### A1. `services/ledger-service/pom.xml` (full file)

````xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>io.github.gradiputera</groupId>
  <artifactId>ledger-service</artifactId>
  <version>0.1.0</version>
  <packaging>jar</packaging>
  <name>ledger-service</name>

  <properties>
    <maven.compiler.release>25</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <vertx.version>5.2.3</vertx.version>
    <flyway.version>13.13.0</flyway.version>
    <postgresql.version>42.7.14</postgresql.version>
    <junit.version>5.14.4</junit.version>
    <main.class>io.github.gradiputera.ledger.Main</main.class>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>io.vertx</groupId>
        <artifactId>vertx-stack-depchain</artifactId>
        <version>${vertx.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
      <dependency>
        <groupId>org.junit</groupId>
        <artifactId>junit-bom</artifactId>
        <version>${junit.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <dependency>
      <groupId>io.vertx</groupId>
      <artifactId>vertx-web</artifactId>
    </dependency>
    <dependency>
      <groupId>io.vertx</groupId>
      <artifactId>vertx-web-client</artifactId>
    </dependency>
    <dependency>
      <groupId>io.vertx</groupId>
      <artifactId>vertx-auth-jwt</artifactId>
    </dependency>
    <dependency>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-core</artifactId>
      <version>${flyway.version}</version>
    </dependency>
    <dependency>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-database-postgresql</artifactId>
      <version>${flyway.version}</version>
    </dependency>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <version>${postgresql.version}</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <finalName>ledger-service</finalName>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-enforcer-plugin</artifactId>
        <version>3.7.0</version>
        <executions>
          <execution>
            <id>enforce-toolchain</id>
            <goals>
              <goal>enforce</goal>
            </goals>
            <configuration>
              <rules>
                <requireJavaVersion>
                  <version>[25,26)</version>
                </requireJavaVersion>
                <requireMavenVersion>
                  <version>[3.9.6,)</version>
                </requireMavenVersion>
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.16.0</version>
        <configuration>
          <compilerArgs>
            <arg>-Xlint:all,-classfile,-processing</arg>
            <arg>-Werror</arg>
          </compilerArgs>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.6.1</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-shade-plugin</artifactId>
        <version>3.6.2</version>
        <executions>
          <execution>
            <phase>package</phase>
            <goals>
              <goal>shade</goal>
            </goals>
            <configuration>
              <createDependencyReducedPom>false</createDependencyReducedPom>
              <transformers>
                <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                  <mainClass>${main.class}</mainClass>
                </transformer>
                <!-- Flyway finds its PostgreSQL support through ServiceLoader files. -->
                <transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
              </transformers>
              <filters>
                <filter>
                  <artifact>*:*</artifact>
                  <excludes>
                    <exclude>META-INF/*.SF</exclude>
                    <exclude>META-INF/*.DSA</exclude>
                    <exclude>META-INF/*.RSA</exclude>
                    <exclude>META-INF/versions/*/module-info.class</exclude>
                    <exclude>module-info.class</exclude>
                  </excludes>
                </filter>
              </filters>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
````

### A2. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/Main.java` (full file)

````java
package io.github.gradiputera.ledger;

import io.github.gradiputera.ledger.auth.JwksLoader;
import io.github.gradiputera.ledger.auth.TokenVerifier;
import io.github.gradiputera.ledger.db.DatabaseUrl;
import io.github.gradiputera.ledger.db.Migrations;
import io.github.gradiputera.ledger.http.HttpApi;
import io.vertx.core.Vertx;
import io.vertx.core.http.HttpServer;
import io.vertx.core.http.HttpServerOptions;
import java.util.concurrent.TimeUnit;
import java.util.logging.ConsoleHandler;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogManager;
import java.util.logging.Logger;

/** Entry point: configuration, migrations, then the Vert.x HTTP server. */
public final class Main {

  private static final Logger LOG = Logger.getLogger(Main.class.getName());

  private Main() {}

  public static void main(String[] args) {
    configureLogging();
    try {
      run();
    } catch (Exception e) {
      LOG.log(Level.SEVERE, "ledger-service stopped: " + e.getMessage());
      System.exit(1);
    }
  }

  private static void run() {
    String databaseUrl = System.getenv("DATABASE_URL");
    String supabaseUrl = System.getenv("SUPABASE_URL");
    if (isBlank(databaseUrl) || isBlank(supabaseUrl)) {
      throw new IllegalStateException("DATABASE_URL and SUPABASE_URL must be set");
    }
    String portValue = System.getenv("PORT");
    int port = isBlank(portValue) ? 80 : Integer.parseInt(portValue);

    // Blocking JDBC work on the main thread, before any event loop exists.
    int applied = Migrations.migrate(DatabaseUrl.parse(databaseUrl));
    LOG.info(() -> "migrations applied: " + applied);

    Vertx vertx = Vertx.vertx();
    TokenVerifier verifier = new TokenVerifier(vertx, JwksLoader.issuerFor(supabaseUrl));
    JwksLoader jwks = new JwksLoader(vertx, supabaseUrl, verifier);
    jwks.start().await();

    HttpServer server = vertx.createHttpServer(new HttpServerOptions()
            .setIdleTimeout(60)
            .setMaxHeaderSize(16 * 1024))
        .requestHandler(HttpApi.router(vertx, verifier::verify, jwks::onVerificationFailure))
        .listen(port)
        .await();
    LOG.info(() -> "listening port=" + server.actualPort());

    // Vercel sends SIGTERM and allows 30 seconds; finish in-flight requests within 20.
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      server.shutdown(20, TimeUnit.SECONDS).await();
      vertx.close().await();
      LOG.info("shut down");
    }, "shutdown"));
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }

  private static void configureLogging() {
    LogManager.getLogManager().reset();
    Handler handler = new ConsoleHandler() {
      {
        setOutputStream(System.out);
      }
    };
    handler.setFormatter(new JsonLogFormatter());
    handler.setLevel(Level.INFO);
    Logger root = Logger.getLogger("");
    root.addHandler(handler);
    root.setLevel(Level.INFO);
  }
}
````

### A3. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/JsonLogFormatter.java` (full file)

````java
package io.github.gradiputera.ledger;

import io.vertx.core.json.JsonObject;
import java.time.Instant;
import java.util.logging.Formatter;
import java.util.logging.LogRecord;

/** One JSON object per line on stdout, which Vercel collects as logs. */
final class JsonLogFormatter extends Formatter {

  @Override
  public String format(LogRecord record) {
    JsonObject line = new JsonObject()
        .put("time", Instant.ofEpochMilli(record.getMillis()).toString())
        .put("level", record.getLevel().getName())
        .put("logger", record.getLoggerName())
        .put("msg", formatMessage(record));
    if (record.getThrown() != null) {
      line.put("error", record.getThrown().toString());
    }
    return line.encode() + System.lineSeparator();
  }
}
````

### A4. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/auth/Identity.java` (full file)

````java
package io.github.gradiputera.ledger.auth;

/** What handlers learn about the caller. It never holds the token itself. */
public record Identity(String userId, boolean anonymous) {}
````

### A5. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/auth/TokenVerifier.java` (full file)

````java
package io.github.gradiputera.ledger.auth;

import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.auth.JWTOptions;
import io.vertx.ext.auth.authentication.TokenCredentials;
import io.vertx.ext.auth.jwt.JWTAuth;
import io.vertx.ext.auth.jwt.JWTAuthOptions;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Validates Supabase Auth access tokens with Vert.x {@code JWTAuth} (ADR 0007): the signature with
 * a key from the project's JWKS, the algorithm (ES256 or RS256 only), {@code iss}, {@code aud}
 * ({@code authenticated}), {@code exp} (required) and {@code sub} (required).
 */
public final class TokenVerifier {

  /** The {@code aud} claim Supabase Auth puts in every user access token, guests included. */
  public static final String AUDIENCE = "authenticated";

  /** Asymmetric algorithms Supabase signing keys use; {@code none} and HS256 are rejected. */
  static final Set<String> ALGORITHMS = Set.of("ES256", "RS256");

  private final Vertx vertx;
  private final String issuer;
  private final AtomicReference<JWTAuth> auth = new AtomicReference<>();

  public TokenVerifier(Vertx vertx, String issuer) {
    this.vertx = vertx;
    this.issuer = issuer;
  }

  public String issuer() {
    return issuer;
  }

  /** Replaces the verification keys with the public keys in a JWKS document. */
  public int useKeys(JsonObject jwks) {
    JWTAuthOptions options = new JWTAuthOptions().setJWTOptions(new JWTOptions()
        .setIssuer(issuer)
        .setAudience(List.of(AUDIENCE))
        .setLeeway(30));
    int added = 0;
    JsonArray keys = jwks.getJsonArray("keys", new JsonArray());
    for (int i = 0; i < keys.size(); i++) {
      JsonObject key = keys.getJsonObject(i);
      boolean signingKey = ALGORITHMS.contains(key.getString("alg"))
          && ("EC".equals(key.getString("kty")) || "RSA".equals(key.getString("kty")))
          && !key.containsKey("d");
      if (signingKey) {
        options.addJwk(key);
        added++;
      }
    }
    if (added == 0) {
      throw new IllegalArgumentException("JWKS contains no ES256 or RS256 public key");
    }
    auth.set(JWTAuth.create(vertx, options));
    return added;
  }

  public boolean hasKeys() {
    return auth.get() != null;
  }

  /** Verifies a token; fails for any invalid token or when no keys are loaded yet. */
  public Future<Identity> verify(String token) {
    JWTAuth current = auth.get();
    if (current == null) {
      return Future.failedFuture("no signing keys loaded");
    }
    String alg;
    try {
      alg = headerAlgorithm(token);
    } catch (RuntimeException e) {
      return Future.failedFuture("malformed token");
    }
    if (!ALGORITHMS.contains(alg)) {
      return Future.failedFuture("algorithm not allowed");
    }
    return current.authenticate(new TokenCredentials(token)).compose(user -> {
      JsonObject claims = user.attributes().getJsonObject("accessToken", new JsonObject());
      Object sub = claims.getValue("sub");
      if (!(claims.getValue("exp") instanceof Number)) {
        return Future.failedFuture("token has no expiry");
      }
      if (!(sub instanceof String subject) || subject.isEmpty()) {
        return Future.failedFuture("token has no subject");
      }
      return Future.succeededFuture(
          new Identity(subject, Boolean.TRUE.equals(claims.getValue("is_anonymous"))));
    });
  }

  private static String headerAlgorithm(String token) {
    int dot = token.indexOf('.');
    if (dot <= 0) {
      throw new IllegalArgumentException("no header");
    }
    byte[] header = Base64.getUrlDecoder().decode(token.substring(0, dot));
    return new JsonObject(new String(header, StandardCharsets.UTF_8)).getString("alg");
  }
}
````

### A6. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/auth/JwksLoader.java` (full file)

````java
package io.github.gradiputera.ledger.auth;

import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import io.vertx.ext.web.client.WebClientOptions;
import io.vertx.ext.web.codec.BodyCodec;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

/**
 * Fetches the Supabase JWKS into a {@link TokenVerifier}: once at startup, then hourly, and at most
 * once every 5 minutes when a token fails because its key is unknown. Every fetch has a 5-second
 * timeout. All of this runs on the event loop with the non-blocking Vert.x web client.
 */
public final class JwksLoader {

  private static final Logger LOG = Logger.getLogger(JwksLoader.class.getName());
  private static final long FETCH_TIMEOUT_MS = 5_000;
  private static final long REFRESH_INTERVAL_MS = TimeUnit.HOURS.toMillis(1);
  private static final long MIN_ON_DEMAND_INTERVAL_MS = TimeUnit.MINUTES.toMillis(5);

  private final Vertx vertx;
  private final WebClient client;
  private final String jwksUrl;
  private final TokenVerifier verifier;
  private long lastOnDemandFetch;

  public JwksLoader(Vertx vertx, String supabaseUrl, TokenVerifier verifier) {
    this.vertx = vertx;
    this.client = WebClient.create(vertx, new WebClientOptions()
        .setConnectTimeout((int) FETCH_TIMEOUT_MS)
        .setUserAgent("ledger-service"));
    this.jwksUrl = stripTrailingSlash(supabaseUrl) + "/auth/v1/.well-known/jwks.json";
    this.verifier = verifier;
  }

  /** The issuer Supabase Auth puts in tokens for this project. */
  public static String issuerFor(String supabaseUrl) {
    return stripTrailingSlash(supabaseUrl) + "/auth/v1";
  }

  /** Fetches once and schedules the hourly refresh. The returned future never fails. */
  public Future<Void> start() {
    vertx.setPeriodic(REFRESH_INTERVAL_MS, id -> fetch());
    return fetch().recover(err -> Future.succeededFuture());
  }

  /** Called when a token could not be verified; refetches at most once every 5 minutes. */
  public void onVerificationFailure() {
    long now = System.currentTimeMillis();
    if (now - lastOnDemandFetch >= MIN_ON_DEMAND_INTERVAL_MS) {
      lastOnDemandFetch = now;
      fetch();
    }
  }

  Future<Void> fetch() {
    return client.getAbs(jwksUrl)
        .timeout(FETCH_TIMEOUT_MS)
        .as(BodyCodec.jsonObject())
        .send()
        .compose(response -> {
          if (response.statusCode() != 200 || response.body() == null) {
            return Future.failedFuture("JWKS answered HTTP " + response.statusCode());
          }
          JsonObject jwks = response.body();
          int keys = verifier.useKeys(jwks);
          LOG.info(() -> "jwks loaded: " + keys + " key(s)");
          return Future.<Void>succeededFuture();
        })
        .onFailure(err -> LOG.warning(() -> "jwks fetch failed: " + err.getMessage()));
  }

  private static String stripTrailingSlash(String url) {
    return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
  }
}
````

### A7. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/db/DatabaseUrl.java` (full file)

````java
package io.github.gradiputera.ledger.db;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * A JDBC connection target derived from a {@code postgres://user:password@host:port/db?params}
 * URL, the same {@code DATABASE_URL} format every service uses. The password stays out of the
 * JDBC URL so it can never appear in a logged URL.
 */
public record DatabaseUrl(String jdbcUrl, String user, String password) {

  public static DatabaseUrl parse(String databaseUrl) {
    URI uri = URI.create(databaseUrl);
    if (!"postgres".equals(uri.getScheme()) && !"postgresql".equals(uri.getScheme())) {
      throw new IllegalArgumentException("DATABASE_URL must start with postgres:// or postgresql://");
    }
    String userInfo = uri.getRawUserInfo();
    if (uri.getHost() == null || userInfo == null || !userInfo.contains(":")) {
      throw new IllegalArgumentException("DATABASE_URL must contain a host, a user and a password");
    }
    int colon = userInfo.indexOf(':');
    String user = URLDecoder.decode(userInfo.substring(0, colon), StandardCharsets.UTF_8);
    String password = URLDecoder.decode(userInfo.substring(colon + 1), StandardCharsets.UTF_8);
    int port = uri.getPort() == -1 ? 5432 : uri.getPort();
    String database = uri.getPath() == null || uri.getPath().length() <= 1 ? "/postgres" : uri.getRawPath();
    String query = uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery();
    String jdbcUrl = "jdbc:postgresql://" + uri.getHost() + ":" + port + database + query;
    return new DatabaseUrl(jdbcUrl, user, password);
  }

  @Override
  public String toString() {
    return "DatabaseUrl[jdbcUrl=" + jdbcUrl + ", user=" + user + ", password=***]";
  }
}
````

### A8. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/db/Migrations.java` (full file)

````java
package io.github.gradiputera.ledger.db;

import java.util.Map;
import org.flywaydb.core.Flyway;

/**
 * Applies ledger-service's own migrations (Flyway, ADR 0006). The schema and its history table
 * ({@code flyway_schema_history}) both live in {@code ledger}, which the platform layer created
 * and the ledger_service role owns.
 *
 * <p>Threading: this is blocking JDBC work. It runs on the main thread before Vert.x starts, so it
 * never touches an event loop.
 */
public final class Migrations {

  private Migrations() {}

  /** Applies pending migrations and returns how many ran. Up-to-date schemas are a no-op. */
  public static int migrate(DatabaseUrl target) {
    Flyway flyway = Flyway.configure()
        .dataSource(target.jdbcUrl(), target.user(), target.password())
        .schemas("ledger")
        .defaultSchema("ledger")
        .createSchemas(false)
        .locations("classpath:db/migration")
        .connectRetries(0)
        // 10-second connect timeout and 30-second statement timeout for every migration connection.
        .jdbcProperties(Map.of("connectTimeout", "10", "options", "-c statement_timeout=30000"))
        .load();
    return flyway.migrate().migrationsExecuted;
  }
}
````

### A9. `services/ledger-service/src/main/java/io/github/gradiputera/ledger/http/HttpApi.java` (full file)

````java
package io.github.gradiputera.ledger.http;

import io.github.gradiputera.ledger.auth.Identity;
import io.vertx.core.Future;
import io.vertx.core.Handler;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import java.util.function.Function;
import java.util.logging.Logger;

/** The ledger-service routes. */
public final class HttpApi {

  /** Routing-context key under which the caller's {@link Identity} is stored. */
  public static final String IDENTITY = "identity";

  private static final Logger LOG = Logger.getLogger(HttpApi.class.getName());

  private HttpApi() {}

  /**
   * Builds the router. {@code verify} turns a bearer token into an identity; {@code onRejected}
   * runs after a token was rejected (used to refresh signing keys).
   */
  public static Router router(Vertx vertx, Function<String, Future<Identity>> verify, Runnable onRejected) {
    Router router = Router.router(vertx);
    router.route().handler(HttpApi::logRequest);
    router.get("/health").handler(ctx -> json(ctx, 200, new JsonObject().put("status", "ok")));

    Handler<RoutingContext> authenticate = ctx -> authenticate(ctx, verify, onRejected);
    // Planned endpoints: authenticated now, implemented by later changes (roadmap step 5).
    router.post("/ledger/postings").handler(authenticate).handler(HttpApi::notImplemented);
    router.get("/ledger/journal").handler(authenticate).handler(HttpApi::notImplemented);
    router.get("/ledger/general-ledger").handler(authenticate).handler(HttpApi::notImplemented);
    router.get("/ledger/trial-balance").handler(authenticate).handler(HttpApi::notImplemented);
    router.post("/sandbox/reset").handler(authenticate).handler(HttpApi::notImplemented);

    router.errorHandler(404, ctx -> json(ctx, 404, error("not_found", "No such route.")));
    router.errorHandler(405, ctx -> json(ctx, 405, error("method_not_allowed", "Method not allowed.")));
    return router;
  }

  private static void authenticate(RoutingContext ctx, Function<String, Future<Identity>> verify, Runnable onRejected) {
    String header = ctx.request().getHeader("Authorization");
    String prefix = "bearer ";
    if (header == null || header.length() <= prefix.length()
        || !header.regionMatches(true, 0, prefix, 0, prefix.length())) {
      unauthorized(ctx, "missing bearer token");
      return;
    }
    verify.apply(header.substring(prefix.length()).trim()).onComplete(result -> {
      if (result.succeeded()) {
        ctx.put(IDENTITY, result.result());
        ctx.next();
      } else {
        onRejected.run();
        unauthorized(ctx, "invalid token");
      }
    });
  }

  private static void unauthorized(RoutingContext ctx, String message) {
    ctx.response().putHeader("WWW-Authenticate", "Bearer realm=\"ledger-service\"");
    json(ctx, 401, error("unauthorized", message));
  }

  private static void notImplemented(RoutingContext ctx) {
    json(ctx, 501, error("not_implemented", "This endpoint is planned and not implemented yet."));
  }

  private static JsonObject error(String code, String message) {
    return new JsonObject().put("error", code).put("message", message);
  }

  private static void json(RoutingContext ctx, int status, JsonObject body) {
    ctx.response()
        .setStatusCode(status)
        .putHeader("Content-Type", "application/json")
        .end(body.encode());
  }

  /** Logs method, route, status and duration only: no headers, tokens, query strings or user ids. */
  private static void logRequest(RoutingContext ctx) {
    long start = System.nanoTime();
    ctx.addEndHandler(done -> {
      String route = ctx.currentRoute() != null && ctx.currentRoute().getPath() != null
          ? ctx.currentRoute().getPath()
          : "unmatched";
      long durationMs = (System.nanoTime() - start) / 1_000_000;
      int status = ctx.response().getStatusCode();
      LOG.info(() -> "request method=" + ctx.request().method() + " route=" + route
          + " status=" + status + " duration_ms=" + durationMs);
    });
    ctx.next();
  }
}
````

### A10. `services/ledger-service/src/main/resources/db/migration/V1__create_ledger.sql` (full file)

````sql
-- Ledger core (ADR 0006): chart of accounts, journal entries and their lines.
-- Amounts are integer minor units; the currency is set once per entry (ISO 4217).

create table accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense'))
);

insert into accounts (code, name, type) values
  ('1000', 'Cash', 'asset'),
  ('1100', 'Settlement Receivable', 'asset'),
  ('2000', 'Customer Funds', 'liability'),
  ('4000', 'Fee Revenue', 'revenue'),
  ('5000', 'Processing Expense', 'expense');

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  kind text not null check (kind in ('opening', 'payment', 'reversal')),
  payment_id uuid,
  reverses_entry_id uuid references journal_entries (id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  posted_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check ((kind = 'reversal') = (reverses_entry_id is not null))
);

create index journal_entries_user_id_posted_at_idx on journal_entries (user_id, posted_at);

create table journal_lines (
  entry_id uuid not null references journal_entries (id) on delete cascade,
  line_no smallint not null check (line_no > 0),
  account_code text not null references accounts (code),
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  primary key (entry_id, line_no),
  -- Each line is either a debit or a credit, never both or neither.
  check ((debit_minor > 0) <> (credit_minor > 0))
);

create index journal_lines_account_code_idx on journal_lines (account_code);

-- Every entry balances: checked at commit, so an entry and its lines are inserted in one
-- transaction. An entry needs at least two lines, and its debits must equal its credits.
create function assert_entry_balances() returns trigger
language plpgsql
as $$
declare
  target uuid;
  line_count integer;
  debits bigint;
  credits bigint;
begin
  if tg_table_name = 'journal_entries' then
    target := new.id;
  else
    target := new.entry_id;
  end if;
  select count(*), coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0)
    into line_count, debits, credits
    from journal_lines
   where entry_id = target;
  if line_count < 2 or debits <> credits then
    raise exception 'journal entry % does not balance: % lines, debits %, credits %',
      target, line_count, debits, credits
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger journal_entries_balance
  after insert on journal_entries
  deferrable initially deferred
  for each row execute function assert_entry_balances();

create constraint trigger journal_lines_balance
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function assert_entry_balances();

-- Append-only: entries and lines are never updated. Sandbox reset (ADR 0011) deletes the
-- caller's entries instead, which cascades to their lines.
create function reject_update() returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

create trigger journal_entries_append_only
  before update on journal_entries
  for each row execute function reject_update();

create trigger journal_lines_append_only
  before update on journal_lines
  for each row execute function reject_update();
````

### A11. `services/ledger-service/src/test/java/io/github/gradiputera/ledger/auth/TokenVerifierTest.java` (full file)

````java
package io.github.gradiputera.ledger.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.auth.JWTOptions;
import io.vertx.ext.auth.jwt.JWTAuth;
import io.vertx.ext.auth.jwt.JWTAuthOptions;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class TokenVerifierTest {

  private static final String ISSUER = "https://project.example/auth/v1";
  private static final String USER = "6f1c7d0e-0000-4000-8000-000000000001";
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

  private static Vertx vertx;
  private static JsonObject ecPrivateJwk;
  private static JsonObject otherEcPrivateJwk;
  private static JsonObject rsaPrivateJwk;

  @BeforeAll
  static void setUp() throws Exception {
    vertx = Vertx.vertx();
    ecPrivateJwk = ecJwk("ec-key");
    otherEcPrivateJwk = ecJwk("ec-key");
    rsaPrivateJwk = rsaJwk("rsa-key");
  }

  @AfterAll
  static void tearDown() {
    vertx.close().await();
  }

  private static TokenVerifier verifier() {
    TokenVerifier verifier = new TokenVerifier(vertx, ISSUER);
    verifier.useKeys(new JsonObject().put("keys", new JsonArray()
        .add(publicPart(ecPrivateJwk))
        .add(publicPart(rsaPrivateJwk))));
    return verifier;
  }

  private static JsonObject claims() {
    return new JsonObject()
        .put("sub", USER)
        .put("iss", ISSUER)
        .put("aud", TokenVerifier.AUDIENCE)
        .put("exp", System.currentTimeMillis() / 1000 + 3600)
        .put("is_anonymous", true);
  }

  private static String sign(JsonObject privateJwk, String alg, JsonObject claims) {
    JWTAuth signer = JWTAuth.create(vertx, new JWTAuthOptions().addJwk(privateJwk));
    return signer.generateToken(claims, new JWTOptions().setAlgorithm(alg).setNoTimestamp(true));
  }

  @Test
  void acceptsValidGuestToken() {
    Identity id = verifier().verify(sign(ecPrivateJwk, "ES256", claims())).await();
    assertEquals(USER, id.userId());
    assertTrue(id.anonymous());
  }

  @Test
  void acceptsValidRs256Token() {
    Identity id = verifier().verify(sign(rsaPrivateJwk, "RS256", claims().put("is_anonymous", false))).await();
    assertEquals(USER, id.userId());
    assertEquals(false, id.anonymous());
  }

  @Test
  void rejectsInvalidTokens() throws Exception {
    TokenVerifier verifier = verifier();
    Map<String, String> cases = new LinkedHashMap<>();
    cases.put("expired", sign(ecPrivateJwk, "ES256", claims().put("exp", System.currentTimeMillis() / 1000 - 3600)));
    JsonObject noExp = claims();
    noExp.remove("exp");
    cases.put("no expiry", sign(ecPrivateJwk, "ES256", noExp));
    cases.put("wrong issuer", sign(ecPrivateJwk, "ES256", claims().put("iss", "https://attacker.example/auth/v1")));
    cases.put("wrong audience", sign(ecPrivateJwk, "ES256", claims().put("aud", "anon")));
    JsonObject noSub = claims();
    noSub.remove("sub");
    cases.put("no subject", sign(ecPrivateJwk, "ES256", noSub));
    cases.put("other signing key", sign(otherEcPrivateJwk, "ES256", claims()));
    cases.put("alg none", unsigned(claims()));
    cases.put("alg HS256", hs256(claims(), "shared-secret-shared-secret-shared"));
    cases.put("garbage", "not-a-jwt");

    for (Map.Entry<String, String> c : cases.entrySet()) {
      assertThrows(Exception.class, () -> verifier.verify(c.getValue()).await(), c.getKey());
    }
  }

  @Test
  void rejectsEverythingBeforeKeysAreLoaded() {
    TokenVerifier empty = new TokenVerifier(vertx, ISSUER);
    assertThrows(Exception.class, () -> empty.verify(sign(ecPrivateJwk, "ES256", claims())).await());
  }

  @Test
  void ignoresSymmetricAndPrivateKeysInJwks() {
    TokenVerifier verifier = new TokenVerifier(vertx, ISSUER);
    JsonObject jwks = new JsonObject().put("keys", new JsonArray()
        .add(new JsonObject().put("kty", "oct").put("alg", "HS256").put("k", "c2VjcmV0"))
        .add(ecPrivateJwk));
    assertThrows(IllegalArgumentException.class, () -> verifier.useKeys(jwks));
  }

  // --- test key and token helpers ---

  private static JsonObject ecJwk(String kid) throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
    generator.initialize(new ECGenParameterSpec("secp256r1"));
    KeyPair pair = generator.generateKeyPair();
    ECPublicKey pub = (ECPublicKey) pair.getPublic();
    ECPrivateKey priv = (ECPrivateKey) pair.getPrivate();
    return new JsonObject()
        .put("kty", "EC").put("crv", "P-256").put("alg", "ES256").put("use", "sig").put("kid", kid)
        .put("x", unsigned(pub.getW().getAffineX(), 32))
        .put("y", unsigned(pub.getW().getAffineY(), 32))
        .put("d", unsigned(priv.getS(), 32));
  }

  private static JsonObject rsaJwk(String kid) throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    KeyPair pair = generator.generateKeyPair();
    RSAPublicKey pub = (RSAPublicKey) pair.getPublic();
    RSAPrivateCrtKey priv = (RSAPrivateCrtKey) pair.getPrivate();
    return new JsonObject()
        .put("kty", "RSA").put("alg", "RS256").put("use", "sig").put("kid", kid)
        .put("n", b64(pub.getModulus())).put("e", b64(pub.getPublicExponent()))
        .put("d", b64(priv.getPrivateExponent()))
        .put("p", b64(priv.getPrimeP())).put("q", b64(priv.getPrimeQ()))
        .put("dp", b64(priv.getPrimeExponentP())).put("dq", b64(priv.getPrimeExponentQ()))
        .put("qi", b64(priv.getCrtCoefficient()));
  }

  private static JsonObject publicPart(JsonObject privateJwk) {
    JsonObject pub = privateJwk.copy();
    for (String field : new String[] {"d", "p", "q", "dp", "dq", "qi"}) {
      pub.remove(field);
    }
    return pub;
  }

  private static String b64(BigInteger value) {
    byte[] bytes = value.toByteArray();
    if (bytes.length > 1 && bytes[0] == 0) {
      bytes = Arrays.copyOfRange(bytes, 1, bytes.length);
    }
    return B64.encodeToString(bytes);
  }

  private static String unsigned(BigInteger value, int length) {
    byte[] bytes = value.toByteArray();
    byte[] fixed = new byte[length];
    int copy = Math.min(bytes.length, length);
    System.arraycopy(bytes, bytes.length - copy, fixed, length - copy, copy);
    return B64.encodeToString(fixed);
  }

  private static String unsigned(JsonObject claims) {
    String header = B64.encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
    String payload = B64.encodeToString(claims.encode().getBytes(StandardCharsets.UTF_8));
    return header + "." + payload + ".";
  }

  private static String hs256(JsonObject claims, String secret) throws Exception {
    String header = B64.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
    String payload = B64.encodeToString(claims.encode().getBytes(StandardCharsets.UTF_8));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    byte[] signature = mac.doFinal((header + "." + payload).getBytes(StandardCharsets.UTF_8));
    return header + "." + payload + "." + B64.encodeToString(signature);
  }
}
````

### A12. `services/ledger-service/src/test/java/io/github/gradiputera/ledger/db/DatabaseUrlTest.java` (full file)

````java
package io.github.gradiputera.ledger.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class DatabaseUrlTest {

  @Test
  void convertsPostgresUrlToJdbc() {
    DatabaseUrl url = DatabaseUrl.parse(
        "postgres://ledger_service.abc:p%40ss%3Aword@pooler.example.com:5432/postgres?sslmode=require");
    assertEquals("jdbc:postgresql://pooler.example.com:5432/postgres?sslmode=require", url.jdbcUrl());
    assertEquals("ledger_service.abc", url.user());
    assertEquals("p@ss:word", url.password());
  }

  @Test
  void defaultsPortAndDatabase() {
    DatabaseUrl url = DatabaseUrl.parse("postgresql://u:p@db.example.com");
    assertEquals("jdbc:postgresql://db.example.com:5432/postgres", url.jdbcUrl());
  }

  @Test
  void neverPrintsThePassword() {
    DatabaseUrl url = DatabaseUrl.parse("postgres://u:secret-value@db.example.com:5432/postgres");
    assertFalse(url.toString().contains("secret-value"));
  }

  @Test
  void rejectsOtherSchemesAndMissingCredentials() {
    assertThrows(IllegalArgumentException.class, () -> DatabaseUrl.parse("mysql://u:p@h/db"));
    assertThrows(IllegalArgumentException.class, () -> DatabaseUrl.parse("postgres://h:5432/db"));
  }
}
````

### A13. `services/ledger-service/src/test/java/io/github/gradiputera/ledger/http/HttpApiTest.java` (full file)

````java
package io.github.gradiputera.ledger.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.gradiputera.ledger.auth.Identity;
import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.http.HttpMethod;
import io.vertx.core.http.HttpServer;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.HttpResponse;
import io.vertx.ext.web.client.WebClient;
import io.vertx.core.buffer.Buffer;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class HttpApiTest {

  private static final String GOOD_TOKEN = "good-token";
  private static final AtomicInteger REJECTIONS = new AtomicInteger();

  private static Vertx vertx;
  private static HttpServer server;
  private static WebClient client;

  @BeforeAll
  static void start() {
    vertx = Vertx.vertx();
    // Stand-in for TokenVerifier, which has its own tests.
    server = vertx.createHttpServer()
        .requestHandler(HttpApi.router(vertx,
            token -> GOOD_TOKEN.equals(token)
                ? Future.succeededFuture(new Identity("user-1", true))
                : Future.failedFuture("invalid"),
            REJECTIONS::incrementAndGet))
        .listen(0)
        .await();
    client = WebClient.create(vertx);
  }

  @AfterAll
  static void stop() {
    vertx.close().await();
  }

  private static HttpResponse<Buffer> call(HttpMethod method, String path, String token) {
    var request = client.request(method, server.actualPort(), "localhost", path);
    if (token != null) {
      request.putHeader("Authorization", "Bearer " + token);
    }
    return request.send().await();
  }

  @Test
  void healthNeedsNoToken() {
    HttpResponse<Buffer> response = call(HttpMethod.GET, "/health", null);
    assertEquals(200, response.statusCode());
    assertEquals("application/json", response.getHeader("Content-Type"));
    assertEquals(new JsonObject().put("status", "ok"), response.bodyAsJsonObject());
  }

  @Test
  void plannedEndpointsRequireTokenThenAnswer501() {
    List<Object[]> endpoints = List.of(
        new Object[] {HttpMethod.POST, "/ledger/postings"},
        new Object[] {HttpMethod.GET, "/ledger/journal"},
        new Object[] {HttpMethod.GET, "/ledger/general-ledger"},
        new Object[] {HttpMethod.GET, "/ledger/trial-balance"},
        new Object[] {HttpMethod.POST, "/sandbox/reset"});
    for (Object[] endpoint : endpoints) {
      HttpMethod method = (HttpMethod) endpoint[0];
      String path = (String) endpoint[1];

      HttpResponse<Buffer> anonymous = call(method, path, null);
      assertEquals(401, anonymous.statusCode(), path + " without token");
      assertNotNull(anonymous.getHeader("WWW-Authenticate"), path + " WWW-Authenticate");

      int before = REJECTIONS.get();
      assertEquals(401, call(method, path, "bad-token").statusCode(), path + " with bad token");
      assertTrue(REJECTIONS.get() > before, path + " rejection callback");

      HttpResponse<Buffer> authorized = call(method, path, GOOD_TOKEN);
      assertEquals(501, authorized.statusCode(), path + " with token");
      assertEquals("not_implemented", authorized.bodyAsJsonObject().getString("error"));
    }
  }

  @Test
  void unknownRoutesAndMethods() {
    assertEquals(404, call(HttpMethod.GET, "/nope", null).statusCode());
    assertEquals(405, call(HttpMethod.GET, "/ledger/postings", null).statusCode());
  }
}
````

### A14. `services/ledger-service/src/test/java/io/github/gradiputera/ledger/integration/LocalStackTest.java` (full file)

````java
package io.github.gradiputera.ledger.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import io.github.gradiputera.ledger.auth.JwksLoader;
import io.github.gradiputera.ledger.auth.TokenVerifier;
import io.github.gradiputera.ledger.db.DatabaseUrl;
import io.github.gradiputera.ledger.db.Migrations;
import io.github.gradiputera.ledger.http.HttpApi;
import io.vertx.core.Vertx;
import io.vertx.core.http.HttpServer;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.client.WebClient;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Runs against the local Supabase stack. Skipped unless LEDGER_TEST_DATABASE_URL,
 * LEDGER_TEST_SUPABASE_URL and LEDGER_TEST_SUPABASE_KEY are set (the ledger-service CI workflow
 * sets them).
 */
class LocalStackTest {

  private static DatabaseUrl database;
  private static String supabaseUrl;
  private static String supabaseKey;

  @BeforeAll
  static void load() {
    String databaseUrl = System.getenv("LEDGER_TEST_DATABASE_URL");
    supabaseUrl = System.getenv("LEDGER_TEST_SUPABASE_URL");
    supabaseKey = System.getenv("LEDGER_TEST_SUPABASE_KEY");
    assumeTrue(databaseUrl != null && supabaseUrl != null && supabaseKey != null,
        "integration environment not set");
    database = DatabaseUrl.parse(databaseUrl);
    Migrations.migrate(database);
  }

  private static Connection connect() throws SQLException {
    return DriverManager.getConnection(database.jdbcUrl(), database.user(), database.password());
  }

  @Test
  void migrationsCreateTablesInOwnSchemaAndRerunIsNoOp() throws SQLException {
    assertEquals(0, Migrations.migrate(database), "second run applies nothing");
    try (Connection c = connect(); Statement s = c.createStatement()) {
      ResultSet tables = s.executeQuery("""
          select to_regclass('ledger.accounts') is not null,
                 to_regclass('ledger.journal_entries') is not null,
                 to_regclass('ledger.journal_lines') is not null,
                 to_regclass('ledger.flyway_schema_history') is not null""");
      tables.next();
      for (int i = 1; i <= 4; i++) {
        assertTrue(tables.getBoolean(i), "table " + i + " exists in ledger");
      }
      ResultSet history = s.executeQuery(
          "select count(*) from ledger.flyway_schema_history where version = '1' and success");
      history.next();
      assertEquals(1, history.getInt(1));
      ResultSet accounts = s.executeQuery("select string_agg(code, ',' order by code) from ledger.accounts");
      accounts.next();
      assertEquals("1000,1100,2000,4000,5000", accounts.getString(1));
    }
  }

  /** Inserts one entry with the given (account, debit, credit) lines in one transaction. */
  private static UUID post(Connection c, long[][] lines, String[] accounts) throws SQLException {
    UUID entry = UUID.randomUUID();
    c.setAutoCommit(false);
    try (PreparedStatement e = c.prepareStatement("""
            insert into journal_entries (id, user_id, idempotency_key, kind, currency)
            values (?, ?, ?, 'opening', 'USD')""");
        PreparedStatement l = c.prepareStatement("""
            insert into journal_lines (entry_id, line_no, account_code, debit_minor, credit_minor)
            values (?, ?, ?, ?, ?)""")) {
      e.setObject(1, entry);
      e.setObject(2, UUID.randomUUID());
      e.setString(3, "it-" + entry);
      e.executeUpdate();
      for (int i = 0; i < lines.length; i++) {
        l.setObject(1, entry);
        l.setInt(2, i + 1);
        l.setString(3, accounts[i]);
        l.setLong(4, lines[i][0]);
        l.setLong(5, lines[i][1]);
        l.executeUpdate();
      }
      c.commit();
      return entry;
    } catch (SQLException ex) {
      c.rollback();
      throw ex;
    } finally {
      c.setAutoCommit(true);
    }
  }

  @Test
  void balancedEntryCommitsAndDebitsEqualCredits() throws SQLException {
    try (Connection c = connect()) {
      UUID entry = post(c, new long[][] {{10_000, 0}, {0, 10_000}}, new String[] {"1000", "2000"});
      try (PreparedStatement q = c.prepareStatement(
          "select sum(debit_minor), sum(credit_minor) from journal_lines where entry_id = ?")) {
        q.setObject(1, entry);
        ResultSet sums = q.executeQuery();
        sums.next();
        assertEquals(10_000, sums.getLong(1));
        assertEquals(sums.getLong(1), sums.getLong(2), "debits equal credits");
      }
      deleteEntry(c, entry);
    }
  }

  @Test
  void unbalancedOrSingleLineEntryIsRejectedAtCommit() throws SQLException {
    try (Connection c = connect()) {
      SQLException unbalanced = assertThrows(SQLException.class,
          () -> post(c, new long[][] {{10_000, 0}, {0, 9_999}}, new String[] {"1000", "2000"}));
      assertEquals("23514", unbalanced.getSQLState(), "check_violation");
      SQLException single = assertThrows(SQLException.class,
          () -> post(c, new long[][] {{10_000, 0}}, new String[] {"1000"}));
      assertEquals("23514", single.getSQLState(), "check_violation");
    }
  }

  @Test
  void journalIsAppendOnly() throws SQLException {
    try (Connection c = connect()) {
      UUID entry = post(c, new long[][] {{500, 0}, {0, 500}}, new String[] {"5000", "4000"});
      try (PreparedStatement u = c.prepareStatement(
          "update journal_lines set debit_minor = 600 where entry_id = ? and line_no = 1")) {
        u.setObject(1, entry);
        SQLException rejected = assertThrows(SQLException.class, u::executeUpdate);
        assertEquals("23001", rejected.getSQLState(), "restrict_violation");
      }
      deleteEntry(c, entry);
    }
  }

  private static void deleteEntry(Connection c, UUID entry) throws SQLException {
    try (PreparedStatement d = c.prepareStatement("delete from journal_entries where id = ?")) {
      d.setObject(1, entry);
      assertEquals(1, d.executeUpdate());
    }
  }

  @Test
  void roleCannotReachOtherSchemas() throws SQLException {
    try (Connection c = connect(); Statement s = c.createStatement()) {
      for (String schema : new String[] {"account", "payment", "notification", "reporting"}) {
        SQLException denied = assertThrows(SQLException.class,
            () -> s.executeQuery("select 1 from " + schema + ".any_table"));
        assertEquals("42501", denied.getSQLState(), "insufficient_privilege on " + schema);
      }
    }
  }

  @Test
  void supabaseGuestTokenIsAccepted() throws Exception {
    Vertx vertx = Vertx.vertx();
    try {
      TokenVerifier verifier = new TokenVerifier(vertx, JwksLoader.issuerFor(supabaseUrl));
      JwksLoader jwks = new JwksLoader(vertx, supabaseUrl, verifier);
      jwks.start().await();
      assertTrue(verifier.hasKeys(), "JWKS loaded from local Supabase");

      HttpServer server = vertx.createHttpServer()
          .requestHandler(HttpApi.router(vertx, verifier::verify, jwks::onVerificationFailure))
          .listen(0)
          .await();
      WebClient client = WebClient.create(vertx);

      int anonymous = client.post(server.actualPort(), "localhost", "/ledger/postings")
          .send().await().statusCode();
      assertEquals(401, anonymous);

      int withGuest = client.post(server.actualPort(), "localhost", "/ledger/postings")
          .putHeader("Authorization", "Bearer " + guestToken())
          .send().await().statusCode();
      assertEquals(501, withGuest);
    } finally {
      vertx.close().await();
    }
  }

  /** Signs in anonymously against local Supabase Auth and returns the access token. */
  private static String guestToken() throws Exception {
    HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    HttpRequest request = HttpRequest.newBuilder(URI.create(supabaseUrl + "/auth/v1/signup"))
        .timeout(Duration.ofSeconds(10))
        .header("apikey", supabaseKey)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("{}"))
        .build();
    HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
    assertEquals(200, response.statusCode(), "anonymous sign-in");
    return new JsonObject(response.body()).getString("access_token");
  }
}
````

### A15. `services/ledger-service/Dockerfile` (full file)

````dockerfile
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
````

### A16. `services/ledger-service/.dockerignore` (full file)

````text
.env
.env.*
target/
src/test/
openspec/
README.md
Dockerfile
.dockerignore
vercel.json
````

### A17. `services/ledger-service/vercel.json` (full file)

````json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "container"
}
````

### A18. `services/ledger-service/.env.example` (full file)

````text
# Local development only. Copy to .env (gitignored). Hosted values live only in Vercel.
PORT=8082
# Local-only role password from supabase/seed.sql; never a real credential.
DATABASE_URL=postgres://ledger_service:local-dev-only-ledger@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
````

### A19. `services/ledger-service/README.md` (full file)

````md
# ledger-service

Double-entry journal, general ledger report and trial balance. Built with Java 25 and Vert.x 5 (Maven), and packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, own-schema migrations with the balance and append-only rules, the container image and CI. The ledger endpoints answer `501` until roadmap step 5.

## Responsibilities

- Owns the `ledger` schema. Migrations use Flyway (`schemas=ledger`), with the history table (`flyway_schema_history`) inside the `ledger` schema, applied on every start.
- Posts double-entry journal entries from payment outcomes. The database enforces two rules:
  - every entry balances: at least two lines, and debits equal credits, checked at commit;
  - entries and lines are never updated (append-only). Sandbox reset deletes instead.
- Serves the general ledger report, the journal and the trial balance.
- Never blocks the event loop. Migrations run on the main thread before Vert.x starts. Later database work uses `executeBlocking` or worker verticles.

## Data model

| Table | Holds |
|---|---|
| `accounts` | Chart of accounts (seeded): 1000 Cash, 1100 Settlement Receivable, 2000 Customer Funds, 4000 Fee Revenue, 5000 Processing Expense |
| `journal_entries` | One row per entry: user, idempotency key (unique per user), kind (`opening`, `payment`, `reversal`), currency (ISO 4217) |
| `journal_lines` | Lines of an entry: account, `debit_minor` or `credit_minor` (integer minor units, exactly one of them positive) |

## API

The contract is [contracts/openapi/ledger.yaml](../../contracts/openapi/ledger.yaml).

| Endpoint | Token | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /ledger/postings` | required | `501` (planned: posts entries for a payment outcome; idempotency key required) |
| `GET /ledger/journal` | required | `501` (planned: the caller's journal entries) |
| `GET /ledger/general-ledger` | required | `501` (planned: per-account running balance, filtered by date range and account) |
| `GET /ledger/trial-balance` | required | `501` (planned: debits equal credits) |
| `POST /sandbox/reset` | required | `501` (planned: deletes the caller's rows and re-applies the opening entries) |

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`.

Tokens are Supabase Auth access tokens, validated by the service with Vert.x `JWTAuth` (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

## Events

- Publishes: `ledger.entry-posted.v1` (through the outbox, in the same transaction as the posting). Planned.
- Consumes: none.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `ledger_service` role. URL-encode special characters in the password. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds (connect and response). It runs at startup and hourly, plus at most one extra fetch every 5 minutes after a rejected token.
- **Database at startup:** 10-second connect timeout and 30-second statement timeout.

## Local development

You need JDK 25 and Maven 3.9.6 or newer, plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `ledger_service` password.
2. Build and run from this folder:
   ```bash
   mvn -B -DskipTests package
   set -a; . ./.env; set +a
   java -jar target/ledger-service.jar
   ```
3. Check it: `curl http://127.0.0.1:8082/health`.

Tests:
- `mvn -B test` runs the unit tests and skips the integration tests.
- To run the integration tests too, with the local stack running:
  ```bash
  eval "$(npx -y supabase@3.2.0 status -o env)"
  LEDGER_TEST_DATABASE_URL="postgres://ledger_service:local-dev-only-ledger@127.0.0.1:54322/postgres" \
  LEDGER_TEST_SUPABASE_URL="$API_URL" LEDGER_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
    mvn -B verify
  ```

Container: `docker build -t ledger-service .`, then run it with the three variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role ledger_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/ledger-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://ledger_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`.

   Use session mode, not transaction mode (port 6543): Flyway needs a session-level advisory lock.
3. **Check.** After the deploy:
   - `https://<ledger-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /ledger/postings` without a token returns `401`.

## Related

- [ADR 0006: Ledger service design](../../architecture/adr/0006-ledger-service-design.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0011: Per-user sandbox seed and reset](../../architecture/adr/0011-per-user-sandbox-seed-and-reset.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
````

### A20. `.github/workflows/ledger-service.yml` (full file)

````yaml
name: ledger-service

on:
  push:
    branches: [main]
    paths:
      - "services/ledger-service/**"
      - "contracts/openapi/ledger.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/ledger-service.yml"
  pull_request:
    paths:
      - "services/ledger-service/**"
      - "contracts/openapi/ledger.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/ledger-service.yml"

permissions:
  contents: read

jobs:
  ledger-service:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    defaults:
      run:
        working-directory: services/ledger-service
    env:
      # Dummy values so env() references in supabase/config.toml resolve. Not real credentials.
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: ci-dummy-client-id
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: ci-dummy-secret
      SUPABASE_AUTH_CAPTCHA_SECRET: ci-dummy-captcha
      # Local-only role password from supabase/seed.sql. Not a real credential.
      LOCAL_DATABASE_URL: postgres://ledger_service:local-dev-only-ledger@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: "25"
          cache: maven

      - name: Validate service specs
        run: npx -y @fission-ai/openspec@latest validate --all --strict

      - name: Check the API contract for breaking changes
        if: github.event_name == 'pull_request'
        working-directory: .
        run: |
          git show "origin/${{ github.base_ref }}:contracts/openapi/ledger.yaml" > "$RUNNER_TEMP/ledger-base.yaml"
          cp contracts/openapi/ledger.yaml "$RUNNER_TEMP/ledger-revision.yaml"
          docker run --rm -v "$RUNNER_TEMP:/specs:ro" tufin/oasdiff:v1.39.0 \
            breaking --fail-on ERR /specs/ledger-base.yaml /specs/ledger-revision.yaml

      - uses: supabase/setup-cli@v3
        with:
          version: 3.2.0

      - name: Generate an ephemeral JWT signing key
        working-directory: .
        run: |
          echo '[]' > supabase/signing_keys.json
          supabase gen signing-key --algorithm ES256 --append

      # Database, auth and gateway only.
      - name: Start the local Supabase stack
        working-directory: .
        run: supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor

      # Unit tests and the integration tests against the local stack, then the shaded jar.
      - name: Test and package
        run: |
          eval "$(supabase status -o env)"
          LEDGER_TEST_DATABASE_URL="$LOCAL_DATABASE_URL" \
          LEDGER_TEST_SUPABASE_URL="$API_URL" \
          LEDGER_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
            mvn -B verify

      - name: Check that the integration tests ran
        run: |
          report=target/surefire-reports/TEST-io.github.gradiputera.ledger.integration.LocalStackTest.xml
          grep -q 'tests="6"' "$report"
          grep -q 'skipped="0"' "$report"
          grep -q 'failures="0"' "$report"

      - name: Build the container image
        run: docker build -t ledger-service:ci .

      - name: Smoke test the container
        run: |
          eval "$(supabase status -o env)"
          docker run -d --name ledger-service --network host \
            -e PORT=8082 -e DATABASE_URL="$LOCAL_DATABASE_URL" -e SUPABASE_URL="$API_URL" \
            ledger-service:ci
          for i in $(seq 1 60); do
            curl -fsS http://127.0.0.1:8082/health && break
            sleep 1
          done
          test "$(curl -s http://127.0.0.1:8082/health)" = '{"status":"ok"}'
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8082/ledger/postings)" = 401
          docker logs ledger-service

      - name: Stop the local Supabase stack
        if: always()
        working-directory: .
        run: supabase stop --no-backup
````

### A21. `contracts/openapi/ledger.yaml` (full file; adds the five `501` responses)

````yaml
openapi: 3.1.0
x-status: planned
info:
  title: ledger-service API
  version: 0.1.0
servers: []
security:
  - bearerAuth: []
paths:
  /health:
    get:
      summary: Health check
      security: []
      responses:
        "200":
          description: Service is healthy.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    const: ok
  /ledger/postings:
    post:
      summary: Post a balanced journal entry for a payment outcome
      responses:
        "201":
          description: Entry posted.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
  /ledger/journal:
    get:
      summary: List journal entries for the caller's sandbox
      responses:
        "200":
          description: Journal entries.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
  /ledger/general-ledger:
    get:
      summary: General ledger per account with running balance
      responses:
        "200":
          description: General ledger report.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
  /ledger/trial-balance:
    get:
      summary: Trial balance (debits equal credits)
      responses:
        "200":
          description: Trial balance.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
  /sandbox/reset:
    post:
      summary: Reset the caller's ledger to the chart of accounts and opening entries
      responses:
        "200":
          description: Caller's rows were deleted and the seed was re-applied.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
````

### A22. `.github/dependabot.yml` (append)

Append these lines at the end of the file, after the last line of the existing payment-service `docker` entry. Keep the two-space indentation: each `- package-ecosystem` line starts with two spaces, at the same level as the existing entries. Change nothing else.

````yaml
  - package-ecosystem: maven
    directory: /services/ledger-service
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /services/ledger-service
    schedule:
      interval: weekly
````
