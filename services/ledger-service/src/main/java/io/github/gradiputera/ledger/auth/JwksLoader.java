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
