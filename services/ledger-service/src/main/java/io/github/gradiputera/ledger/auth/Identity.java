package io.github.gradiputera.ledger.auth;

/** What handlers learn about the caller. It never holds the token itself. */
public record Identity(String userId, boolean anonymous) {}
