-- Seller approval: an applicant's ID documents are reviewed by an admin (or by a KYC provider when one is configured).
-- The ID number is encrypted by the API (AES-256-GCM, FieldCipher); the photos live in the private reports bucket.
ALTER TABLE seller_profiles
  ADD COLUMN kyc_id_type           text CHECK (kyc_id_type IN ('national_id','passport','voter_id','drivers_licence')),
  ADD COLUMN kyc_id_number_enc     text,
  ADD COLUMN kyc_id_photo_key      text,
  ADD COLUMN kyc_selfie_key        text,
  ADD COLUMN kyc_submitted_at      timestamptz,
  ADD COLUMN kyc_reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN kyc_reviewed_at       timestamptz,
  ADD COLUMN kyc_rejection_reason  text;

CREATE INDEX seller_profiles_kyc_queue_idx ON seller_profiles (kyc_status, kyc_submitted_at) WHERE kyc_status IN ('pending','rejected','verified');

-- Old manual-review items are replaced by the seller approvals queue.
UPDATE moderation_items SET status = 'dismissed', decided_at = now() WHERE reason = 'kyc_manual_review' AND status = 'open';
