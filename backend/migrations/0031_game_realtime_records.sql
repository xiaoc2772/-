-- +goose Up
CREATE INDEX IF NOT EXISTS idx_game_records_game_session
  ON game_records(game_type, session_id);

-- +goose Down
DROP INDEX IF EXISTS idx_game_records_game_session;
