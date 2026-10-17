-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExperimenterRole" AS ENUM ('ADMIN', 'EXPERIMENTER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeviceMode" AS ENUM ('NONE', 'CAMERA', 'CONTROLLER');

-- CreateEnum
CREATE TYPE "MatchingStrategy" AS ENUM ('FIFO', 'PROPERTY', 'MANUAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('WAITING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "SessionParticipantStatus" AS ENUM ('ACTIVE', 'DROPPED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('UPLOADING', 'COMPLETE', 'FAILED', 'SAVED_LOCALLY');

-- CreateEnum
CREATE TYPE "ErrorSource" AS ENUM ('SERVER_HTTP', 'SERVER_SOCKET', 'SERVER_TASK', 'CLIENT');

-- CreateEnum
CREATE TYPE "ErrorStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "Experimenter" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ExperimenterRole" NOT NULL DEFAULT 'EXPERIMENTER',
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experimenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimenterExperiment" (
    "experimenterId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,

    CONSTRAINT "ExperimenterExperiment_pkey" PRIMARY KEY ("experimenterId","experimentId")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "allowNew" BOOLEAN NOT NULL DEFAULT true,
    "img" TEXT,
    "avCollection" BOOLEAN NOT NULL DEFAULT false,
    "bodyDetection" BOOLEAN NOT NULL DEFAULT false,
    "videoChat" BOOLEAN NOT NULL DEFAULT false,
    "supplementaryDevice" "DeviceMode" NOT NULL DEFAULT 'NONE',
    "activeTime" INTEGER NOT NULL DEFAULT 30,
    "rollBackTime" INTEGER NOT NULL DEFAULT 60,
    "participantsPerSession" INTEGER NOT NULL DEFAULT 1,
    "participantIdParam" TEXT,
    "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentCondition" TEXT,
    "randomization" BOOLEAN NOT NULL DEFAULT false,
    "randomizationConfig" JSONB,
    "matchingStrategy" "MatchingStrategy" NOT NULL DEFAULT 'FIFO',
    "initialProperties" JSONB NOT NULL DEFAULT '{}',
    "conditionProperties" JSONB NOT NULL DEFAULT '{}',
    "routines" JSONB NOT NULL,
    "sessionDesigns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "experimenterId" TEXT,
    "email" TEXT,
    "password" TEXT,
    "responseId" TEXT NOT NULL,
    "externalId" TEXT,
    "roomId" TEXT,
    "condition" TEXT,
    "progressSequence" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStage" INTEGER NOT NULL DEFAULT 0,
    "isLoggedIn" BOOLEAN NOT NULL DEFAULT false,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "completion" BOOLEAN NOT NULL DEFAULT false,
    "withdraw" BOOLEAN NOT NULL DEFAULT false,
    "role" INTEGER NOT NULL DEFAULT 0,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "lastLogTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "routineName" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'WAITING',
    "matchProgress" INTEGER NOT NULL DEFAULT 0,
    "matchedAt" TIMESTAMP(3),
    "sharedProgressSequence" JSONB,
    "blockId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignmentCycle" (
    "experimentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "blockOrder" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleAssignmentCycle_pkey" PRIMARY KEY ("experimentId")
);

-- CreateTable
CREATE TABLE "SessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL DEFAULT 0,
    "slotName" TEXT,
    "status" "SessionParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "droppedAt" TIMESTAMP(3),

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionGrouping" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "trialNumber" INTEGER NOT NULL DEFAULT 1,
    "routineName" TEXT NOT NULL,
    "groupIndex" INTEGER NOT NULL,
    "seats" INTEGER[],
    "participantIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionGrouping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentContent" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "trialNumber" INTEGER NOT NULL DEFAULT 1,
    "routine" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'Basic',
    "description" TEXT,

    CONSTRAINT "ExperimentContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "trial" INTEGER NOT NULL DEFAULT 1,
    "routine" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "trialInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "trial" INTEGER NOT NULL,
    "elementName" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'video/webm',
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "status" "UploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "ErrorSource" NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "experimentId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ErrorStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "participantId" TEXT,
    "responseId" TEXT,
    "routine" TEXT,
    "progress" INTEGER,
    "context" JSONB,
    "stack" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Experimenter_email_key" ON "Experimenter"("email");

-- CreateIndex
CREATE INDEX "Participant_experimentId_externalId_idx" ON "Participant"("experimentId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_sessionId_participantId_key" ON "SessionParticipant"("sessionId", "participantId");

-- CreateIndex
CREATE INDEX "SessionGrouping_sessionId_idx" ON "SessionGrouping"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionGrouping_sessionId_progress_groupIndex_key" ON "SessionGrouping"("sessionId", "progress", "groupIndex");

-- CreateIndex
CREATE INDEX "ExperimentContent_experimentId_progress_idx" ON "ExperimentContent"("experimentId", "progress");

-- CreateIndex
CREATE INDEX "ExperimentResult_experimentId_participantId_idx" ON "ExperimentResult"("experimentId", "participantId");

-- CreateIndex
CREATE INDEX "Upload_experimentId_participantId_idx" ON "Upload"("experimentId", "participantId");

-- CreateIndex
CREATE INDEX "Asset_experimentId_idx" ON "Asset"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_fingerprint_key" ON "ErrorGroup"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorGroup_experimentId_status_lastSeenAt_idx" ON "ErrorGroup"("experimentId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ErrorGroup_lastSeenAt_idx" ON "ErrorGroup"("lastSeenAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_groupId_occurredAt_idx" ON "ErrorEvent"("groupId", "occurredAt");

-- AddForeignKey
ALTER TABLE "ExperimenterExperiment" ADD CONSTRAINT "ExperimenterExperiment_experimenterId_fkey" FOREIGN KEY ("experimenterId") REFERENCES "Experimenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimenterExperiment" ADD CONSTRAINT "ExperimenterExperiment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignmentCycle" ADD CONSTRAINT "RoleAssignmentCycle_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionGrouping" ADD CONSTRAINT "SessionGrouping_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentContent" ADD CONSTRAINT "ExperimentContent_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentResult" ADD CONSTRAINT "ExperimentResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentResult" ADD CONSTRAINT "ExperimentResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ErrorGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

