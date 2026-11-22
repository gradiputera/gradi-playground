package io.github.gradiputera.ledger;

import io.vertx.core.json.JsonObject;
import java.time.Instant;
import java.util.logging.Formatter;
import java.util.logging.LogRecord;

/** One JSON object per line on stdout, which Vercel collects as logs. */
final class JsonLogFormatter extends Formatter {

  @Override
  public String format(LogRecord record) {
    JsonObject line = new JsonObject()
        .put("time", Instant.ofEpochMilli(record.getMillis()).toString())
        .put("level", record.getLevel().getName())
        .put("logger", record.getLoggerName())
        .put("msg", formatMessage(record));
    if (record.getThrown() != null) {
      line.put("error", record.getThrown().toString());
    }
    return line.encode() + System.lineSeparator();
  }
}
