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
