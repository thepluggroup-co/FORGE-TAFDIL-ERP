-- Migration: table documents justificatifs sur crédits (Gap 5 CDC MOD-04)
-- Storage bucket: credit-documents (créer manuellement dans Supabase Dashboard)

CREATE TABLE IF NOT EXISTS credit_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id    UUID NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  nom_fichier  TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  taille_bytes INTEGER DEFAULT 0,
  created_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE credit_documents ENABLE ROW LEVEL SECURITY;

-- Lecture : directeur et admin uniquement
CREATE POLICY "credit_documents_select" ON credit_documents
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('directeur', 'admin')
    )
  );

-- Insertion : directeur et admin uniquement
CREATE POLICY "credit_documents_insert" ON credit_documents
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('directeur', 'admin')
    )
  );

-- Suppression : directeur uniquement
CREATE POLICY "credit_documents_delete" ON credit_documents
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'directeur'
    )
  );

-- Index pour accès par crédit
CREATE INDEX IF NOT EXISTS idx_credit_documents_credit_id ON credit_documents(credit_id);

-- Note : créer le bucket Storage "credit-documents" (public=false) dans le Dashboard Supabase
-- et ajouter la policy : directeur/admin peuvent upload/download
