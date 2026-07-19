"""Utility helpers for mypkg."""
from .models import User


def greet(user: User, times: int = 1) -> str:
    """Greet a user a number of times."""
    return f"Hi {user.name}! " * times


def _internal_helper() -> None:
    pass
