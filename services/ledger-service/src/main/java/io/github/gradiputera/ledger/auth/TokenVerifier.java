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
