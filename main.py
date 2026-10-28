"""Canonical entrypoint for the Maestro SmartResto POS application.

The project intentionally uses the Python standard library HTTP server (see
``server.py``) instead of an ASGI framework, so there is no FastAPI lifespan
handler to bootstrap. Running either ``python main.py`` or ``python server.py``
starts the same app on http://127.0.0.1:8000.
"""

from server import main


if __name__ == "__main__":
    main()
