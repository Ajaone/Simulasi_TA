import logging
import os
import secrets
from os import path

from flask import Flask
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
DB_NAME = "database.db"


def create_app():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    app = Flask(__name__)

    # SECRET_KEY from env. If missing, generate a per-process random key so
    # development still works; warn loudly because sessions won't survive a
    # restart and this is unsafe for production.
    secret = os.getenv("FLASK_SECRET_KEY")
    if not secret:
        secret = secrets.token_urlsafe(32)
        app.logger.warning(
            "FLASK_SECRET_KEY not set; using a random per-process key. "
            "Set FLASK_SECRET_KEY in the environment for production."
        )
    app.config["SECRET_KEY"] = secret
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{DB_NAME}"
    db.init_app(app)

    from .views import views
    from .auth import auth

    app.register_blueprint(views, url_prefix="/")
    app.register_blueprint(auth, url_prefix="/")

    from .models import User  # noqa: F401  (register model)

    create_database(app)
    return app


def create_database(app):
    if not path.exists("website/" + DB_NAME):
        with app.app_context():
            db.create_all()
        app.logger.info("Created database file")
