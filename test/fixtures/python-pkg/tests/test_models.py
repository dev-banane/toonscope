"""Tests for mypkg models."""
from mypkg.models import User, Greeter


def test_user_creation():
    user = User(id=1, name="Ada")
    assert user.name == "Ada"


def test_greeter():
    g = Greeter()
    assert g.greet(User(id=1, name="Ada")) == "Hello, Ada!"
