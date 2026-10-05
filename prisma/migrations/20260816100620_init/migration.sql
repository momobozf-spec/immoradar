-- CreateEnum
CREATE TYPE "SourceAccessMethod" AS ENUM ('OFFICIAL_API', 'PUBLIC_FEED', 'STRUCTURED_DATA', 'PUBLIC_HTML', 'FIXTURE', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "SourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILING', 'BLOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CollectorRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'GARAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('PRIVATE', 'PROFESSIONAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'MISSING', 'REMOVED', 'DUPLICATE', 'REDACTED');

-- CreateEnum
CREATE TYPE "ListingEventType" AS ENUM ('NEW_LISTING', 'FSBO_DETECTED', 'PRICE_DROP', 'PRICE_INCREASE', 'STALE_30', 'STALE_60', 'STALE_90', 'LISTING_REMOVED', 'RELISTED', 'AGENCY_TO_PRIVATE', 'PRIVATE_TO_AGENCY');

-- CreateEnum
CREATE TYPE "OpportunityOrigin" AS ENUM ('MARKET', 'LEADREVIVE', 'CROSS');

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('NEW_FSBO', 'STALE_FSBO', 'PRIVATE_PRICE_DROP', 'PRIVATE_MULTIPLE_PRICE_DROP', 'PRIVATE_RELIST', 'AGENCY_TO_PRIVATE', 'DORMANT_VALUATION_LEAD', 'FORMER_SELLER_PROSPECT', 'FORMER_CLIENT', 'PREVIOUS_BUYER', 'LOST_MANDATE', 'UNCONTACTED_LEAD');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'ASSIGNED', 'TO_CONTACT', 'CONTACTED', 'INTERESTED', 'VALUATION_BOOKED', 'MANDATE_PROPOSED', 'MANDATE_WON', 'LOST', 'DISMISSED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "TerritoryKind" AS ENUM ('POSTAL_CODE', 'MUNICIPALITY', 'PROVINCE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'AGENCY_ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('TELEGRAM');

-- CreateEnum
CREATE TYPE "AlertRuleKind" AS ENUM ('REALTIME', 'DIGEST');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED_DRY_RUN');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('BUYER', 'SELLER', 'LANDLORD', 'TENANT', 'VALUATION_LEAD', 'PROSPECT', 'FORMER_CLIENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'DORMANT', 'LOST', 'WON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InteractionKind" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'VISIT', 'VALUATION', 'MANDATE', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmImportStatus" AS ENUM ('PENDING', 'ANALYZING', 'READY', 'IMPORTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrmImportRowStatus" AS ENUM ('PENDING', 'CREATED', 'UPDATED', 'SKIPPED_DUPLICATE', 'SKIPPED_INVALID', 'FAILED');

-- CreateEnum
CREATE TYPE "ContactPropertyRole" AS ENUM ('OWNER', 'FORMER_OWNER', 'BUYER', 'SELLER', 'TENANT', 'VALUATION_SUBJECT', 'INTERESTED');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "accessMethod" "SourceAccessMethod" NOT NULL,
    "baseUrl" TEXT,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 20,
    "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "health" "SourceHealth" NOT NULL DEFAULT 'UNKNOWN',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lockedBy" TEXT,
    "accessNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "CollectorRunStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "itemsFetched" INTEGER NOT NULL DEFAULT 0,
    "itemsNew" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "itemsRejected" INTEGER NOT NULL DEFAULT 0,
    "eventsDetected" INTEGER NOT NULL DEFAULT 0,
    "opportunities" INTEGER NOT NULL DEFAULT 0,
    "alertsSent" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorKind" TEXT,
    "error" TEXT,

    CONSTRAINT "CollectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "address" TEXT,
    "streetName" TEXT,
    "houseNumber" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "province" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'OTHER',
    "bedrooms" INTEGER,
    "surfaceArea" INTEGER,
    "matchKey" TEXT,
    "listingCycles" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerIdentity" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "phoneE164" TEXT,
    "normalizedName" TEXT,
    "classification" "SellerType" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activeListingCount" INTEGER NOT NULL DEFAULT 0,
    "agencyIdentityId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "SellerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyIdentity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "website" TEXT,
    "phoneE164" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceListingId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "listingType" "ListingType" NOT NULL DEFAULT 'SALE',
    "propertyType" "PropertyType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "description" TEXT,
    "currentPrice" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "initialPrice" INTEGER,
    "priceDropCount" INTEGER NOT NULL DEFAULT 0,
    "sellerId" TEXT,
    "sellerType" "SellerType" NOT NULL DEFAULT 'UNKNOWN',
    "sellerConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "classificationReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "missedRuns" INTEGER NOT NULL DEFAULT 0,
    "previousListingId" TEXT,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "staleDaysReported" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingSnapshot" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" INTEGER,
    "title" TEXT,
    "description" TEXT,
    "sellerName" TEXT,
    "sellerPhone" TEXT,
    "status" "ListingStatus" NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawData" JSONB,

    CONSTRAINT "ListingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "ListingEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oldPrice" INTEGER,
    "newPrice" INTEGER,
    "absoluteDrop" INTEGER,
    "percentageDrop" DOUBLE PRECISION,
    "daysOnMarket" INTEGER,
    "oldSellerType" "SellerType",
    "newSellerType" "SellerType",
    "detail" TEXT,
    "payload" JSONB,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "ListingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT,
    "telegramChatId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "identityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "agencyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TerritoryKind" NOT NULL,
    "postalCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "municipalities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxOpportunitiesPerDay" INTEGER NOT NULL DEFAULT 50,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "externalId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "province" TEXT,
    "emailNormalized" TEXT,
    "phoneE164" TEXT,
    "nameNormalized" TEXT,
    "addressMatchKey" TEXT,
    "contactType" "ContactType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "ContactStatus" NOT NULL DEFAULT 'UNKNOWN',
    "leadType" TEXT,
    "assignedUserId" TEXT,
    "assignedAgentName" TEXT,
    "notes" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "relationshipScore" INTEGER NOT NULL DEFAULT 0,
    "dormantSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmInteraction" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" "InteractionKind" NOT NULL DEFAULT 'NOTE',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT,
    "agentName" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImport" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "adapter" TEXT NOT NULL DEFAULT 'csv',
    "fileName" TEXT,
    "fileHash" TEXT,
    "status" "CrmImportStatus" NOT NULL DEFAULT 'PENDING',
    "columnMapping" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdById" TEXT,

    CONSTRAINT "CrmImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "CrmImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "raw" JSONB NOT NULL,
    "contactId" TEXT,
    "message" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPropertyRelationship" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "propertyId" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "addressMatchKey" TEXT,
    "role" "ContactPropertyRole" NOT NULL DEFAULT 'OWNER',
    "since" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPropertyRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "origin" "OpportunityOrigin" NOT NULL DEFAULT 'MARKET',
    "type" "OpportunityType" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
    "propertyId" TEXT,
    "listingId" TEXT,
    "sourceEventId" TEXT,
    "crmContactId" TEXT,
    "crmMatchConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crmMatchReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "score" INTEGER NOT NULL DEFAULT 0,
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "relationshipScore" INTEGER NOT NULL DEFAULT 0,
    "matchedTerritoryId" TEXT,
    "matchedTerritoryName" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "contactedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityReason" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT 'intent',
    "rank" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OpportunityReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySignal" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityScore" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "intent" INTEGER NOT NULL DEFAULT 0,
    "relationship" INTEGER NOT NULL DEFAULT 0,
    "timing" INTEGER NOT NULL DEFAULT 0,
    "territory" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "weightsVersion" TEXT NOT NULL DEFAULT 'v1',
    "breakdown" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityAssignment" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "OpportunityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityActivity" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "fromStatus" "OpportunityStatus",
    "toStatus" "OpportunityStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AlertRuleKind" NOT NULL DEFAULT 'REALTIME',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "channel" "AlertChannel" NOT NULL DEFAULT 'TELEGRAM',
    "telegramChatId" TEXT,
    "minScore" INTEGER NOT NULL DEFAULT 60,
    "types" "OpportunityType"[] DEFAULT ARRAY[]::"OpportunityType"[],
    "requireCrmMatch" BOOLEAN NOT NULL DEFAULT false,
    "digestHour" INTEGER NOT NULL DEFAULT 7,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "alertRuleId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "channel" "AlertChannel" NOT NULL DEFAULT 'TELEGRAM',
    "status" "AlertStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "agencyId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE INDEX "Source_enabled_cooldownUntil_idx" ON "Source"("enabled", "cooldownUntil");

-- CreateIndex
CREATE INDEX "CollectorRun_sourceId_startedAt_idx" ON "CollectorRun"("sourceId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CollectorRun_startedAt_idx" ON "CollectorRun"("startedAt" DESC);

-- CreateIndex
CREATE INDEX "Property_matchKey_idx" ON "Property"("matchKey");

-- CreateIndex
CREATE INDEX "Property_postalCode_propertyType_idx" ON "Property"("postalCode", "propertyType");

-- CreateIndex
CREATE INDEX "Property_city_idx" ON "Property"("city");

-- CreateIndex
CREATE INDEX "Property_lastSeenAt_idx" ON "Property"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SellerIdentity_phoneE164_key" ON "SellerIdentity"("phoneE164");

-- CreateIndex
CREATE INDEX "SellerIdentity_classification_idx" ON "SellerIdentity"("classification");

-- CreateIndex
CREATE INDEX "SellerIdentity_agencyIdentityId_idx" ON "SellerIdentity"("agencyIdentityId");

-- CreateIndex
CREATE INDEX "SellerIdentity_normalizedName_idx" ON "SellerIdentity"("normalizedName");

-- CreateIndex
CREATE INDEX "SellerIdentity_lastSeenAt_idx" ON "SellerIdentity"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyIdentity_normalizedName_key" ON "AgencyIdentity"("normalizedName");

-- CreateIndex
CREATE INDEX "AgencyIdentity_lastSeenAt_idx" ON "AgencyIdentity"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_previousListingId_key" ON "Listing"("previousListingId");

-- CreateIndex
CREATE INDEX "Listing_propertyId_firstSeenAt_idx" ON "Listing"("propertyId", "firstSeenAt" DESC);

-- CreateIndex
CREATE INDEX "Listing_status_lastSeenAt_idx" ON "Listing"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Listing_sellerType_status_idx" ON "Listing"("sellerType", "status");

-- CreateIndex
CREATE INDEX "Listing_sourceId_status_idx" ON "Listing"("sourceId", "status");

-- CreateIndex
CREATE INDEX "Listing_status_firstSeenAt_idx" ON "Listing"("status", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_sourceId_sourceListingId_key" ON "Listing"("sourceId", "sourceListingId");

-- CreateIndex
CREATE INDEX "ListingSnapshot_listingId_capturedAt_idx" ON "ListingSnapshot"("listingId", "capturedAt" DESC);

-- CreateIndex
CREATE INDEX "ListingSnapshot_capturedAt_idx" ON "ListingSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingEvent_dedupeKey_key" ON "ListingEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "ListingEvent_propertyId_occurredAt_idx" ON "ListingEvent"("propertyId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ListingEvent_listingId_occurredAt_idx" ON "ListingEvent"("listingId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ListingEvent_type_occurredAt_idx" ON "ListingEvent"("type", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ListingEvent_occurredAt_idx" ON "ListingEvent"("occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_slug_key" ON "Agency"("slug");

-- CreateIndex
CREATE INDEX "Agency_active_idx" ON "Agency"("active");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_agencyId_active_idx" ON "User"("agencyId", "active");

-- CreateIndex
CREATE INDEX "Territory_agencyId_active_idx" ON "Territory"("agencyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_agencyId_key" ON "Subscription"("agencyId");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_contactType_status_idx" ON "CrmContact"("agencyId", "contactType", "status");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_lastContactAt_idx" ON "CrmContact"("agencyId", "lastContactAt");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_phoneE164_idx" ON "CrmContact"("agencyId", "phoneE164");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_emailNormalized_idx" ON "CrmContact"("agencyId", "emailNormalized");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_addressMatchKey_idx" ON "CrmContact"("agencyId", "addressMatchKey");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_nameNormalized_idx" ON "CrmContact"("agencyId", "nameNormalized");

-- CreateIndex
CREATE INDEX "CrmContact_agencyId_postalCode_idx" ON "CrmContact"("agencyId", "postalCode");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_agencyId_externalId_key" ON "CrmContact"("agencyId", "externalId");

-- CreateIndex
CREATE INDEX "CrmInteraction_contactId_occurredAt_idx" ON "CrmInteraction"("contactId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "CrmInteraction_agencyId_occurredAt_idx" ON "CrmInteraction"("agencyId", "occurredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CrmInteraction_agencyId_externalId_key" ON "CrmInteraction"("agencyId", "externalId");

-- CreateIndex
CREATE INDEX "CrmImport_agencyId_startedAt_idx" ON "CrmImport"("agencyId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CrmImportRow_importId_status_idx" ON "CrmImportRow"("importId", "status");

-- CreateIndex
CREATE INDEX "CrmImportRow_contactId_idx" ON "CrmImportRow"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmImportRow_importId_rowNumber_key" ON "CrmImportRow"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "ContactPropertyRelationship_agencyId_addressMatchKey_idx" ON "ContactPropertyRelationship"("agencyId", "addressMatchKey");

-- CreateIndex
CREATE INDEX "ContactPropertyRelationship_propertyId_idx" ON "ContactPropertyRelationship"("propertyId");

-- CreateIndex
CREATE INDEX "ContactPropertyRelationship_contactId_idx" ON "ContactPropertyRelationship"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPropertyRelationship_agencyId_contactId_addressMatch_key" ON "ContactPropertyRelationship"("agencyId", "contactId", "addressMatchKey", "role");

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_status_score_idx" ON "Opportunity"("agencyId", "status", "score" DESC);

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_createdAt_idx" ON "Opportunity"("agencyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_origin_status_idx" ON "Opportunity"("agencyId", "origin", "status");

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_type_status_idx" ON "Opportunity"("agencyId", "type", "status");

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_assignedUserId_status_idx" ON "Opportunity"("agencyId", "assignedUserId", "status");

-- CreateIndex
CREATE INDEX "Opportunity_crmContactId_idx" ON "Opportunity"("crmContactId");

-- CreateIndex
CREATE INDEX "Opportunity_propertyId_idx" ON "Opportunity"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_agencyId_dedupeKey_key" ON "Opportunity"("agencyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "OpportunityReason_opportunityId_rank_idx" ON "OpportunityReason"("opportunityId", "rank");

-- CreateIndex
CREATE INDEX "OpportunitySignal_opportunityId_idx" ON "OpportunitySignal"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunitySignal_opportunityId_code_key" ON "OpportunitySignal"("opportunityId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityScore_opportunityId_key" ON "OpportunityScore"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityAssignment_opportunityId_assignedAt_idx" ON "OpportunityAssignment"("opportunityId", "assignedAt" DESC);

-- CreateIndex
CREATE INDEX "OpportunityAssignment_assignedToId_unassignedAt_idx" ON "OpportunityAssignment"("assignedToId", "unassignedAt");

-- CreateIndex
CREATE INDEX "OpportunityActivity_opportunityId_createdAt_idx" ON "OpportunityActivity"("opportunityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OpportunityActivity_userId_createdAt_idx" ON "OpportunityActivity"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OpportunityActivity_kind_createdAt_idx" ON "OpportunityActivity"("kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AlertRule_agencyId_enabled_kind_idx" ON "AlertRule"("agencyId", "enabled", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_agencyId_createdAt_idx" ON "Alert"("agencyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_opportunityId_idx" ON "Alert"("opportunityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_agencyId_createdAt_idx" ON "AuditLog"("agencyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "CollectorRun" ADD CONSTRAINT "CollectorRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerIdentity" ADD CONSTRAINT "SellerIdentity_agencyIdentityId_fkey" FOREIGN KEY ("agencyIdentityId") REFERENCES "AgencyIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_previousListingId_fkey" FOREIGN KEY ("previousListingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingSnapshot" ADD CONSTRAINT "ListingSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingEvent" ADD CONSTRAINT "ListingEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingEvent" ADD CONSTRAINT "ListingEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "AgencyIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Territory" ADD CONSTRAINT "Territory_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImport" ADD CONSTRAINT "CrmImport_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImport" ADD CONSTRAINT "CrmImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportRow" ADD CONSTRAINT "CrmImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CrmImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmImportRow" ADD CONSTRAINT "CrmImportRow_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPropertyRelationship" ADD CONSTRAINT "ContactPropertyRelationship_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPropertyRelationship" ADD CONSTRAINT "ContactPropertyRelationship_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPropertyRelationship" ADD CONSTRAINT "ContactPropertyRelationship_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "ListingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_crmContactId_fkey" FOREIGN KEY ("crmContactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityReason" ADD CONSTRAINT "OpportunityReason_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunitySignal" ADD CONSTRAINT "OpportunitySignal_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityScore" ADD CONSTRAINT "OpportunityScore_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAssignment" ADD CONSTRAINT "OpportunityAssignment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAssignment" ADD CONSTRAINT "OpportunityAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAssignment" ADD CONSTRAINT "OpportunityAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
