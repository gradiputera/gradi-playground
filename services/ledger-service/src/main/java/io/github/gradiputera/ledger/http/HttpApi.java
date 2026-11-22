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
