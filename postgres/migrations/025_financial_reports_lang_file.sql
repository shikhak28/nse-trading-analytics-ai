-- Results Reader: a reading per language (English or Hinglish), and the
-- uploaded file kept on disk (file_path, relative to backend/report-files).
ALTER TABLE financial_reports ADD COLUMN lang VARCHAR(16) NOT NULL DEFAULT 'hinglish';
ALTER TABLE financial_reports ADD COLUMN file_path VARCHAR(255);
ALTER TABLE financial_reports ALTER COLUMN lang SET DEFAULT 'english';
DROP INDEX IF EXISTS idx_financial_reports_file;
CREATE UNIQUE INDEX idx_financial_reports_file ON financial_reports (symbol, file_sha256, lang);
