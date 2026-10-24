ALTER TABLE "Message"
    ADD COLUMN "replyToId" BIGINT,
    ADD COLUMN "deletedAt" TIMESTAMP(3),
    ADD COLUMN "deletedBy" TEXT;

CREATE TABLE "MessageHide" (
    "chatId" INTEGER NOT NULL,
    "messageId" BIGINT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageHide_pkey" PRIMARY KEY ("chatId", "messageId", "characterId")
);
CREATE INDEX "MessageHide_characterId_chatId_idx" ON "MessageHide"("characterId", "chatId");

CREATE TABLE "ChatPushSubscription" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "encrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatPushSubscription_endpointHash_key" ON "ChatPushSubscription"("endpointHash");
CREATE INDEX "ChatPushSubscription_characterId_idx" ON "ChatPushSubscription"("characterId");

CREATE TABLE "ChatPushDelivery" (
    "chatId" INTEGER NOT NULL,
    "messageId" BIGINT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatPushDelivery_pkey" PRIMARY KEY ("chatId", "messageId", "recipientId")
);
