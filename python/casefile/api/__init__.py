"""FastAPI service module.

The `app` object is provided lazily so that importing the `casefile.api`
package does not require FastAPI to be installed (e.g. for CLI or headless
use of the pipeline modules).
"""

__all__ = ["app"]


def __getattr__(name: str):
    if name == "app":
        from .server import app  # noqa: F401

        return app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")