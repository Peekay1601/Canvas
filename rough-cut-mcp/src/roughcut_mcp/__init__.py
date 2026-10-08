"""Local MCP server for logging footage and building Premiere Pro rough cuts."""

import os


def setting(name: str) -> str:
    """An environment setting, treating an unfilled Claude Desktop placeholder like '${user_config.x}' as unset."""
    value = os.environ.get(name, "").strip()
    return "" if value.startswith("${") else value
