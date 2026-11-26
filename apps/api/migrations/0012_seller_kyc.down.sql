DROP INDEX IF EXISTS seller_profiles_kyc_queue_idx;
ALTER TABLE seller_profiles
  DROP COLUMN IF EXISTS kyc_id_type, DROP COLUMN IF EXISTS kyc_id_number_enc, DROP COLUMN IF EXISTS kyc_id_photo_key, DROP COLUMN IF EXISTS kyc_selfie_key,
  DROP COLUMN IF EXISTS kyc_submitted_at, DROP COLUMN IF EXISTS kyc_reviewed_by, DROP COLUMN IF EXISTS kyc_reviewed_at, DROP COLUMN IF EXISTS kyc_rejection_reason;
