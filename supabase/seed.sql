insert into public.users (id, display_name) values
('11111111-1111-4111-8111-111111111111', 'James'),
('22222222-2222-4222-8222-222222222222', 'Ahmed'),
('33333333-3333-4333-8333-333333333333', 'Sam'),
('44444444-4444-4444-8444-444444444444', 'Ryan')
on conflict (id) do nothing;

-- The application FakeTikTokProvider supplies deterministic media in normal local development.
-- This seed keeps the database identities predictable for SQL/integration work without storing credentials.
