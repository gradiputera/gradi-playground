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
