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
