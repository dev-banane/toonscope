"""Domain models for mypkg."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class User:
    """A user record."""

    id: int
    name: str
    email: Optional[str] = None


class Greeter:
    """Greets users politely."""

    def __init__(self, greeting: str = "Hello", *, loud: bool = False) -> None:
        """Create a greeter with a custom greeting."""
        self.greeting = greeting
        self.loud = loud

    def greet(self, user: User, *names: str, **opts: str) -> str:
        """Return a greeting for the given user."""
        return f"{self.greeting}, {user.name}!"

    @property
    def shout(self) -> bool:
        """Whether greetings are shouted."""
        return self.loud

    @shout.setter
    def shout(self, value: bool) -> None:
        self.loud = value

    def _internal(self) -> None:
        pass
