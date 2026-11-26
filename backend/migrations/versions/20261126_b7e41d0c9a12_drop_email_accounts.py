"""Drop email registration: accounts are identified by handle only.

Revision ID: b7e41d0c9a12
Revises: 4f29b2c67a01
"""

import sqlalchemy as sa
from alembic import op

revision = "b7e41d0c9a12"
down_revision = "4f29b2c67a01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("email_verifications")
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "email")


def downgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(254), nullable=True))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True)))
    op.create_unique_constraint("uq_users_email", "users", ["email"])
    op.create_table(
        "email_verifications",
        sa.Column("email", sa.String(254), primary_key=True),
        sa.Column("username", sa.String(32)),
        sa.Column("password", sa.String()),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
