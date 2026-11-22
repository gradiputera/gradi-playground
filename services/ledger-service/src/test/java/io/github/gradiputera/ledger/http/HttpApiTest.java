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
