-- API tokens: the `apikey` table of @better-auth/api-key 1.7.23, in the column types `npx auth generate` uses for D1
-- (see 0002). Better Auth fills defaults itself. The plugin declares no foreign key on "referenceId" (the user id);
-- ours deletes a Member's tokens with their account (ADR 0005).

create table "apikey" ("id" text not null primary key, "configId" text not null, "name" text, "start" text, "referenceId" text not null references "user" ("id") on delete cascade, "prefix" text, "key" text not null, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date not null, "updatedAt" date not null, "permissions" text, "metadata" text);

create index "apikey_configId_idx" on "apikey" ("configId");

create index "apikey_referenceId_idx" on "apikey" ("referenceId");

create index "apikey_key_idx" on "apikey" ("key");
