from flask import Blueprint, render_template, make_response, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash

from . import db
from .models import User

auth = Blueprint('auth', __name__)


@auth.route("/api/login", methods=['POST'])
def api_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    user = User.query.filter_by(email=email).first()
    if user and check_password_hash(user.password, password):
        return make_response(jsonify({"message": "Login successful", "user_id": user.id}), 200)
    return make_response(jsonify({"message": "Invalid email or password"}), 401)


@auth.route("/api/sign-up", methods=['POST'])
def api_sign_up():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if User.query.filter_by(email=email).first():
        return make_response(jsonify({"message": "Email is already used"}), 409)
    if not email or len(email) < 4:
        return make_response(jsonify({"message": "Email is invalid"}), 401)
    if len(password) < 7:
        return make_response(jsonify({"message": "Password too short"}), 401)

    new_user = User(email=email, password=generate_password_hash(password))
    db.session.add(new_user)
    db.session.commit()
    return make_response(jsonify({"message": "User created!", "user_id": new_user.id}), 201)


@auth.route('/login')
def login():
    return render_template("login.html")


@auth.route('/sign-up')
def sign_up():
    return render_template("sign_up.html")
