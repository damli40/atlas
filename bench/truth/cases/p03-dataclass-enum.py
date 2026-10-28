# A ticket as a dataclass with an Enum status.
from dataclasses import asdict, dataclass, field
from enum import Enum


class Status(Enum):
    OPEN = "open"
    CLOSED = "closed"


@dataclass
class Ticket:
    id: int
    title: str
    status: Status = Status.OPEN
    tags: list = field(default_factory=list)


def close_ticket(raw):
    t = Ticket(**raw)
    t.status = Status.CLOSED
    t.tags.append("done")
    d = asdict(t)
    d["status"] = t.status.value
    return d


def ticket_object(raw):
    return Ticket(**raw)


def status_of(name):
    return Status[name].value
