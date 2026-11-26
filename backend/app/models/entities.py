from datetime import datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


def identifier() -> str:
    return uuid4().hex


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    password: Mapped[str]
    bio: Mapped[str] = mapped_column(default="")
    avatar: Mapped[str | None]
    recovery_code_hash: Mapped[str | None] = mapped_column(String(64))
    admin: Mapped[bool] = mapped_column(default=False)
    blocked: Mapped[bool] = mapped_column(default=False)
    deleted: Mapped[bool] = mapped_column(default=False)


class LoginSession(Base):
    __tablename__ = "login_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Pin(Base, TimestampMixin):
    __tablename__ = "pins"
    __table_args__ = (
        CheckConstraint("kind IN ('image', 'track', 'video')", name="kind"),
        Index("ix_pins_created", "created_at", "id"),
        Index("ix_pins_owner_created", "owner_id", "created_at", "id"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str]
    file: Mapped[str]
    cover: Mapped[str | None]


class PinCollection(Base, TimestampMixin):
    __tablename__ = "pin_collections"
    __table_args__ = (Index("ix_pin_collections_owner_created", "owner_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str]
    public: Mapped[bool] = mapped_column(default=False)


class CollectionPin(Base, TimestampMixin):
    __tablename__ = "collection_pins"
    __table_args__ = (
        CheckConstraint("(pin_id IS NULL) <> (catalog_id IS NULL)", name="material"),
        UniqueConstraint("collection_id", "pin_id", name="uq_collection_pins_upload"),
        UniqueConstraint("collection_id", "catalog_id", name="uq_collection_pins_catalog"),
        Index("ix_collection_pins_pin_id", "pin_id"),
        Index("ix_collection_pins_collection_created", "collection_id", "created_at", "id"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    collection_id: Mapped[str] = mapped_column(ForeignKey("pin_collections.id", ondelete="CASCADE"))
    pin_id: Mapped[str | None] = mapped_column(ForeignKey("pins.id", ondelete="CASCADE"))
    catalog_id: Mapped[str | None] = mapped_column(String(160))


class Board(Base, TimestampMixin):
    __tablename__ = "boards"
    __table_args__ = (
        CheckConstraint("visibility IN ('private', 'link', 'public')", name="visibility"),
        Index("ix_boards_feed", "visibility", "published_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    share_id: Mapped[str] = mapped_column(String(32), unique=True, default=identifier)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    theme: Mapped[str] = mapped_column(String(20), default="blue")
    cover: Mapped[str | None]
    visibility: Mapped[str] = mapped_column(String(10), default="private")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(default=0)
    hidden: Mapped[bool] = mapped_column(default=False)
    deleted: Mapped[bool] = mapped_column(default=False)


class Media(Base):
    __tablename__ = "media"
    __table_args__ = (
        UniqueConstraint("provider", "external_id"),
        CheckConstraint("kind IN ('track', 'film', 'image')", name="kind"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    kind: Mapped[str] = mapped_column(String(10))
    provider: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str]
    title: Mapped[str]
    creator: Mapped[str] = mapped_column(default="")
    year: Mapped[int | None]
    source: Mapped[str] = mapped_column(default="")
    artwork: Mapped[str | None]
    file: Mapped[str | None]
    preview: Mapped[str | None]


class Item(Base, TimestampMixin):
    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("board_id", "position", deferrable=True, initially="DEFERRED"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id"))
    media_id: Mapped[str] = mapped_column(ForeignKey("media.id"))
    position: Mapped[int]
    note: Mapped[str] = mapped_column(default="")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'accepted', 'declined')", name="status"),
    )

    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")


class Follow(Base, TimestampMixin):
    __tablename__ = "follows"
    __table_args__ = (CheckConstraint("follower_id <> target_id", name="distinct"),)

    follower_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    target_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True, index=True)


class Like(Base, TimestampMixin):
    __tablename__ = "likes"
    __table_args__ = (
        CheckConstraint("kind IN ('board', 'item')", name="kind"),
        Index("ix_likes_object", "kind", "object_id", "created_at"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), primary_key=True)
    object_id: Mapped[str] = mapped_column(String(32), primary_key=True)


class Comment(Base, TimestampMixin):
    __tablename__ = "comments"
    __table_args__ = (Index("ix_comments_board_date", "board_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.id"))
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str]
    hidden: Mapped[bool] = mapped_column(default=False)
    deleted: Mapped[bool] = mapped_column(default=False)


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_recipient_date", "recipient_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(10))
    board_id: Mapped[str | None] = mapped_column(ForeignKey("boards.id"))
    object_id: Mapped[str | None] = mapped_column(String(32))
    read: Mapped[bool] = mapped_column(default=False)


class Report(Base, TimestampMixin):
    __tablename__ = "reports"
    __table_args__ = (
        CheckConstraint("kind IN ('board', 'comment')", name="kind"),
        UniqueConstraint("reporter_id", "kind", "object_id"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    reporter_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(10))
    object_id: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str]
    resolution: Mapped[str | None]


class Audit(Base, TimestampMixin):
    __tablename__ = "audit"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    admin_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(10))
    object_id: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str]
    report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.id"))
