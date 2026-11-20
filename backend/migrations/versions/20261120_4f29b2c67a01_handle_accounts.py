"""Allow accounts registered with a handle and a recovery code.

Revision ID: 4f29b2c67a01
Revises: 9d6f2c1b4a80
"""

import sqlalchemy as sa
from alembic import op

revision = "4f29b2c67a01"
down_revision = "9d6f2c1b4a80"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(254), nullable=True)
    op.add_column("users", sa.Column("recovery_code_hash", sa.String(64)))


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT 1 FROM users WHERE email IS NULL LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade while accounts without email exist.")
    op.drop_column("users", "recovery_code_hash")
    op.alter_column("users", "email", existing_type=sa.String(254), nullable=False)
