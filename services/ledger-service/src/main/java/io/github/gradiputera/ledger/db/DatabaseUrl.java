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
