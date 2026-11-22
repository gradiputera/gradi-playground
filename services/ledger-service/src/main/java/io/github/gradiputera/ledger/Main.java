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
