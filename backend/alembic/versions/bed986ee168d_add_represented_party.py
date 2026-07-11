"""add represented_party

Revision ID: bed986ee168d
Revises: 0001_initial
Create Date: 2026-07-11 14:59:03.051187

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'bed986ee168d'
down_revision: Union[str, None] = '0001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reviews', sa.Column('represented_party', sa.String(), nullable=False, server_default='Client'))


def downgrade() -> None:
    op.drop_column('reviews', 'represented_party')
