"""What the child did with the box's search pool (MuPiBox fork "wishes").

The box keeps a short list of what the child put on the display's start page
from the search pool ("added"), took out again ("removed") or wished from
Spotify for the parents to decide ("wish", with "url": the app's page
"Wünsche" on the address Home Assistant reaches the box by), and playlists it
made itself ("created"); a single song ("kind": "track") goes into one of its
playlists ("playlist": its name) instead of a tab:
GET /api/ha/v1/search_events?after=<id>, scope "read", capability
"search_events". The coordinator asks for the new ones and fires one Home
Assistant event per entry (SEARCH_EVENT). This module has no Home Assistant
imports, so its logic can be checked on its own.
"""

from __future__ import annotations

from typing import Any

SEARCH_EVENT = "mupibox_search_event"
SEARCH_EVENTS_CAPABILITY = "search_events"
# how often the box is asked (seconds) - the coordinator itself runs every 5 s
SEARCH_EVENTS_INTERVAL_SECONDS = 15

CATEGORY_LABELS = {"audiobook": "Hörspiele", "music": "Musik", "other": "Radio"}
KIND_LABELS = {
    "artist": "Künstler",
    "album": "Album",
    "playlist": "Playlist",
    "show": "Podcast",
    "podcast": "Podcast",
    "radio": "Radiosender",
    "track": "Song",
}
WHATS = ("added", "removed", "wish", "created")


def valid_events(payload: Any) -> list[dict[str, Any]]:
    """The entries of the box's answer that have what an event needs, oldest first."""
    events = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(events, list):
        return []
    found = [
        e
        for e in events
        if isinstance(e, dict)
        and isinstance(e.get("id"), int)
        and not isinstance(e.get("id"), bool)
        and e.get("what") in WHATS
    ]
    return sorted(found, key=lambda e: e["id"])


def next_events(
    payload: Any, last_seen: int | None
) -> tuple[list[dict[str, Any]], int | None]:
    """The events to fire and the id seen last afterwards.

    The first answer after a start (last_seen None) only sets the starting
    point: what happened before Home Assistant was running is not announced
    again. When the box's list started anew (its last id below the one seen),
    its ids are followed from there. An answer without a valid last_id changes
    nothing (else the count went back and old entries were announced again).
    """
    last_id = payload.get("last_id") if isinstance(payload, dict) else None
    if not isinstance(last_id, int) or isinstance(last_id, bool) or last_id < 0:
        return [], last_seen
    events = valid_events(payload)
    box_last = last_id
    if last_seen is None:
        return [], box_last
    if box_last < last_seen:
        return [], box_last
    new = [e for e in events if e["id"] > last_seen]
    return new, max([last_seen, *(e["id"] for e in new)])


def event_data(event: dict[str, Any], box_name: str, entry_id: str) -> dict[str, Any]:
    """The data of one Home Assistant event, with a ready German message."""
    name = str(event.get("name") or "").strip()
    artist = str(event.get("artist") or "").strip()
    category = str(event.get("category") or "")
    kind = str(event.get("kind") or "")
    what = str(event.get("what") or "")
    category_label = CATEGORY_LABELS.get(category, category)
    title = f"„{name}“" + (f" ({artist})" if artist and artist != name else "")
    url = str(event.get("url") or "")
    playlist = str(event.get("playlist") or "").strip()
    link = f" Freigeben: {url}" if url else ""
    if kind == "track" and playlist:
        # (a single song: into one of the child's playlists, not under a tab)
        if what == "added":
            message = f"{title} wurde in die Playlist „{playlist}“ gelegt."
        elif what == "wish":
            message = f"Wunsch: {title} für die Playlist „{playlist}“." + link
        else:
            message = f"{title} wurde aus der Playlist „{playlist}“ genommen."
    elif what == "created":
        message = f"Neue Playlist „{name}“ unter {category_label} angelegt."
    elif what == "added":
        message = f"{title} wurde unter {category_label} auf die Startseite geholt."
    elif what == "wish":
        message = f"Wunsch: {title} unter {category_label}." + link
    else:
        message = f"{title} wurde von der Startseite ({category_label}) entfernt."
    return {
        "box": box_name,
        "config_entry_id": entry_id,
        "id": event.get("id"),
        "at": event.get("at"),
        "what": what,
        "kind": kind,
        "kind_label": KIND_LABELS.get(kind, kind),
        "name": name,
        "artist": artist,
        "category": category,
        "category_label": category_label,
        "playlist": playlist,
        "message": message,
        "url": url,
    }
