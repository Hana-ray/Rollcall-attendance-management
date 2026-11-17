from collections import Counter
import hashlib
import hmac
import os
import secrets
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, String,
                        UniqueConstraint, create_engine, select)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

url = os.getenv("DATABASE_URL")
if os.getenv("REQUIRE_POSTGRES") == "1" and not (url or "").startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
    raise RuntimeError("Set DATABASE_URL to a PostgreSQL connection string.")
url = url or "sqlite:///attendance.sqlite"
if url.startswith(("postgres://", "postgresql://")):
    url = "postgresql+psycopg://" + url.split("://", 1)[1]
engine = create_engine(url, pool_pre_ping=True)
Session = sessionmaker(engine)
app = FastAPI(title="Rollcall Attendance API")

class Base(DeclarativeBase):
    pass

class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(150), unique=True)
    password: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10))

class LoginSession(Base):
    __tablename__ = "login_sessions"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    expires: Mapped[datetime] = mapped_column(DateTime)

class Student(Base):
    __tablename__ = "students"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    code: Mapped[str] = mapped_column(String(30), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class Classroom(Base):
    __tablename__ = "classrooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    teacher_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class Enrollment(Base):
    __tablename__ = "enrollments"
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id"), primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), primary_key=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

class Roll(Base):
    __tablename__ = "rolls"
    __table_args__ = (UniqueConstraint("classroom_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id"))
    day: Mapped[date] = mapped_column(Date)

class Mark(Base):
    __tablename__ = "marks"
    roll_id: Mapped[int] = mapped_column(ForeignKey("rolls.id"), primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String(10))

def password_key(password, salt=None):
    salt = salt or secrets.token_hex(16)
    key = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
    return salt + ":" + key.hex()

Base.metadata.create_all(engine)
with Session.begin() as db:
    initial = os.getenv("ADMIN_PASSWORD")
    if initial:
        if len(initial) < 12:
            raise RuntimeError("ADMIN_PASSWORD must have at least 12 characters")
        email = os.getenv("ADMIN_EMAIL", "admin@example.com").strip().lower()
        if not db.scalar(select(Account).where(Account.email == email)):
            db.add(Account(name="Administrator", email=email, password=password_key(initial), role="admin"))

def session_db():
    with Session() as db:
        yield db

Db = Depends(session_db)

def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

def token_key(token):
    return hashlib.sha256(token.encode()).hexdigest()

def identity(db=Db, attendance_session: str = Cookie(default="")):
    login = db.get(LoginSession, token_key(attendance_session)) if attendance_session else None
    if not login or login.expires <= now():
        raise HTTPException(401, "Sign in to continue.")
    return db.get(Account, login.account_id)

User = Depends(identity)

def admin(user):
    if user.role != "admin":
        raise HTTPException(403, "Administrator access required.")

def room_for(db, user, room_id, lock=False):
    query = select(Classroom).where(Classroom.id == room_id)
    if lock:
        query = query.with_for_update()
    room = db.scalar(query)
    if not room or (user.role != "admin" and room.teacher_id != user.id):
        raise HTTPException(404, "Class not found.")
    return room

class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=150)
    password: str = Field(min_length=1, max_length=128)

class TeacherInput(Credentials):
    name: str = Field(min_length=1, max_length=100)

class StudentInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=30)

class ClassInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    teacher_id: int | None = None

class RollInput(BaseModel):
    marks: dict[int, Literal["Present", "Absent", "Late", "Excused"]]

def show_account(user):
    return dict(id=user.id, name=user.name, email=user.email, role=user.role)

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/login")
def login(body: Credentials, response: Response, db=Db):
    user = db.scalar(select(Account).where(Account.email == body.email.strip().lower()))
    stored = user.password if user else "00" * 16 + ":" + "00" * 64
    valid = hmac.compare_digest(stored, password_key(body.password, stored.split(":")[0]))
    if not user or not valid:
        raise HTTPException(401, "Email or password is incorrect.")
    token = secrets.token_urlsafe(32)
    db.add(LoginSession(key=token_key(token), account_id=user.id, expires=now() + timedelta(hours=8)))
    db.commit()
    response.set_cookie("attendance_session", token, httponly=True, samesite="strict",
                        secure=os.getenv("COOKIE_SECURE") == "1", max_age=28800)
    return show_account(user)

@app.post("/api/logout", status_code=204)
def logout(response: Response, db=Db, attendance_session: str = Cookie(default="")):
    session = db.get(LoginSession, token_key(attendance_session))
    if session:
        db.delete(session)
        db.commit()
    response.delete_cookie("attendance_session")

@app.get("/api/me")
def me(user=User):
    return show_account(user)

@app.get("/api/teachers")
def teachers(user=User, db=Db):
    admin(user)
    return [show_account(row) for row in db.scalars(select(Account).where(Account.role == "teacher"))]

@app.post("/api/teachers", status_code=201)
def add_teacher(body: TeacherInput, user=User, db=Db):
    admin(user)
    email = body.email.strip().lower()
    if "@" not in email or not body.name.strip() or len(body.password) < 12:
        raise HTTPException(422, "Enter a name, email and a password of at least 12 characters.")
    if db.scalar(select(Account).where(Account.email == email)):
        raise HTTPException(409, "That email is already in use.")
    db.add(Account(name=body.name.strip(), email=email, password=password_key(body.password), role="teacher"))
    db.commit()
    return {"saved": True}

def show_student(student):
    return dict(id=student.id, name=student.name, code=student.code, active=student.active)

def show_room(room):
    return dict(id=room.id, name=room.name, teacher_id=room.teacher_id, active=room.active)

@app.get("/api/students")
def students(user=User, db=Db):
    admin(user)
    return [show_student(row) for row in db.scalars(select(Student).order_by(Student.name))]

@app.post("/api/students", status_code=201)
@app.put("/api/students/{record_id}")
def save_student(body: StudentInput, record_id: int | None = None, user=User, db=Db):
    admin(user)
    name, code = body.name.strip(), body.code.strip()
    if not name or not code:
        raise HTTPException(422, "Enter a name and student code.")
    found = db.scalar(select(Student).where(Student.code == code))
    if found and found.id != record_id:
        raise HTTPException(409, "That student code is already in use.")
    student = db.get(Student, record_id) if record_id else Student()
    if not student:
        raise HTTPException(404, "Student not found.")
    student.name, student.code = name, code
    db.add(student)
    db.commit()
    return show_student(student)

@app.delete("/api/students/{record_id}")
def archive_student(record_id: int, user=User, db=Db):
    admin(user)
    student = db.get(Student, record_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    student.active = False
    db.commit()
    return {"saved": True}

@app.get("/api/classes")
def classes(user=User, db=Db):
    query = select(Classroom).order_by(Classroom.name)
    if user.role != "admin":
        query = query.where(Classroom.teacher_id == user.id)
    return [show_room(row) for row in db.scalars(query)]

@app.post("/api/classes", status_code=201)
@app.put("/api/classes/{record_id}")
def save_class(body: ClassInput, record_id: int | None = None, user=User, db=Db):
    admin(user)
    if not body.name.strip():
        raise HTTPException(422, "Enter a class name.")
    if body.teacher_id is not None:
        teacher = db.get(Account, body.teacher_id)
        if not teacher or teacher.role != "teacher":
            raise HTTPException(422, "Select a teacher account.")
    room = room_for(db, user, record_id, lock=True) if record_id else Classroom()
    room.name, room.teacher_id = body.name.strip(), body.teacher_id
    db.add(room)
    db.commit()
    return show_room(room)

@app.delete("/api/classes/{record_id}")
def archive_class(record_id: int, user=User, db=Db):
    admin(user)
    room_for(db, user, record_id, lock=True).active = False
    db.commit()
    return {"saved": True}

@app.put("/api/classes/{room_id}/roster")
def set_roster(room_id: int, student_ids: list[int], user=User, db=Db):
    admin(user)
    if not room_for(db, user, room_id, lock=True).active:
        raise HTTPException(409, "This class is archived.")
    ids = set(student_ids)
    valid = set(db.scalars(select(Student.id).where(Student.id.in_(ids), Student.active)))
    if ids != valid:
        raise HTTPException(422, "Select active students only.")
    previous = {row.student_id: row for row in db.scalars(select(Enrollment).where(Enrollment.classroom_id == room_id))}
    for student_id, row in previous.items():
        row.active = student_id in ids
    for student_id in ids - previous.keys():
        db.add(Enrollment(classroom_id=room_id, student_id=student_id))
    db.commit()
    return {"saved": True}

def roll_data(db, room_id, day):
    roll = db.scalar(select(Roll).where(Roll.classroom_id == room_id, Roll.day == day))
    marks = {row.student_id: row for row in db.scalars(select(Mark).where(Mark.roll_id == roll.id))} if roll else {}
    active = set(db.scalars(select(Student.id).join(Enrollment).where(
        Enrollment.classroom_id == room_id, Enrollment.active, Student.active)))
    students = db.scalars(select(Student).where(Student.id.in_(active | marks.keys())).order_by(Student.name))
    return roll, marks, active, [show_student(row) | {"status": marks[row.id].status if row.id in marks else None} for row in students]

@app.get("/api/classes/{room_id}/attendance/{day}")
def attendance(room_id: int, day: date, user=User, db=Db):
    room = room_for(db, user, room_id)
    _, _, active, rows = roll_data(db, room_id, day)
    return {"room": show_room(room), "rows": rows, "enrolled": sorted(active)}

@app.put("/api/classes/{room_id}/attendance/{day}")
def save_attendance(room_id: int, day: date, body: RollInput, user=User, db=Db):
    if not room_for(db, user, room_id, lock=True).active:
        raise HTTPException(409, "This class is archived.")
    roll, previous, active, _ = roll_data(db, room_id, day)
    if not body.marks or not set(body.marks) <= (active | previous.keys()):
        raise HTTPException(422, "Mark at least one student on the roster.")
    if not roll:
        roll = Roll(classroom_id=room_id, day=day)
        db.add(roll)
        db.flush()
    for student_id, status in body.marks.items():
        if student_id in previous:
            previous[student_id].status = status
        else:
            db.add(Mark(roll_id=roll.id, student_id=student_id, status=status))
    db.commit()
    return {"saved": True}

@app.get("/api/reports")
def reports(room_id: int, start: date, end: date, student_id: int | None = None, user=User, db=Db):
    room_for(db, user, room_id)
    if end < start:
        raise HTTPException(422, "The end date must come after the start date.")
    query = select(Roll.day, Student.name, Student.code, Mark.status).join(
        Mark, Mark.roll_id == Roll.id).join(Student, Student.id == Mark.student_id).where(
        Roll.classroom_id == room_id, Roll.day.between(start, end)).order_by(Roll.day.desc(), Student.name)
    if student_id is not None:
        query = query.where(Student.id == student_id)
    return [dict(row._mapping) for row in db.execute(query)]

@app.get("/api/overview")
def overview(end: date, room_id: int | None = None, user=User, db=Db):
    if end.toordinal() < 7:
        raise HTTPException(422, "Choose a week ending on or after January 7, year 1.")
    start = end - timedelta(days=6)
    query = (
        select(Roll.day, Mark.status)
        .join(Mark, Mark.roll_id == Roll.id)
        .join(Classroom, Classroom.id == Roll.classroom_id)
        .where(Roll.day.between(start, end))
    )
    if user.role != "admin":
        query = query.where(Classroom.teacher_id == user.id)
    if room_id is not None:
        room_for(db, user, room_id)
        query = query.where(Roll.classroom_id == room_id)
    counts = Counter((day, status) for day, status in db.execute(query))
    return [
        {"day": day, **{status: counts[day, status] for status in ("Present", "Absent", "Late", "Excused")}}
        for offset in range(7)
        for day in [start + timedelta(days=offset)]
    ]

dist = Path(__file__).parent / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
