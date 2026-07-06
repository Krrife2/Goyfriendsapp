-- Effect choice (bubble/screen animation) is plaintext metadata, like
-- reactions or timestamps -- it doesn't reveal message content, just how the
-- bubble/screen should animate when displayed. Message body stays encrypted
-- separately as always.
alter table messages add column effect text;
