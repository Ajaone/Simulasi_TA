from flask import Blueprint, render_template, make_response, request, flash, jsonify
from . import db
from .models import User
from werkzeug.security import generate_password_hash, check_password_hash
 
auth = Blueprint('auth', __name__)

@auth.route("/api/login", methods=['POST'])
def api_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    user = User.query.filter_by(email=email).first()
    if user :
        if not check_password_hash(user.password, password):
            return make_response(jsonify({"message": "Password Incorrect"}), 401)

        return  make_response(jsonify({"message": "Login successful", 'user_id': user.typing_id}), 200)
    else:
        return make_response(jsonify({"message": "Invalid email or password"}), 401)
    
@auth.route("/api/sign-up", methods=['POST'])
def api_sign_up():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    user = User.query.filter_by(email=email).first()
    if user or len(email) < 4:
        return make_response(jsonify({"message": "Email is invalid"}), 401)
    elif len(password) < 7:
        return make_response(jsonify({"message": "Password too short"}), 401)
    else:
        new_user = User(email=email, password=generate_password_hash(password))
        db.session.add(new_user)
        db.session.commit()
        return make_response(jsonify({"message": "User created!", 'user_id': new_user.typing_id}), 201)


@auth.route("/api/verify-password", methods=['POST'])
def api_verify_password():
    data = request.get_json() or {}
    user_id = data.get('user_id')
    password = data.get('password') or ''

    if not user_id or not password:
        return make_response(jsonify({"match": False, "message": "Missing fields"}), 400)

    user = User.query.filter_by(typing_id=user_id).first()
    if not user:
        return make_response(jsonify({"match": False, "message": "User not found"}), 404)

    if not check_password_hash(user.password, password):
        return make_response(jsonify({"match": False, "message": "Password does not match the one used at sign-up"}), 401)

    return make_response(jsonify({"match": True}), 200)


@auth.route('/login')
def login():
    return render_template("login.html")


@auth.route('/sign-up')
def sign_up():
    return render_template("sign_up.html")
