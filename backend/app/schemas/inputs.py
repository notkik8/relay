from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True)]
Tags = Annotated[list[Annotated[Text, Field(min_length=1, max_length=40)]], Field(max_length=12)]
Handle = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_]{3,32}$")]
Visibility = Literal["private", "link", "public"]
Theme = Literal["blue", "amber", "violet", "moss", "rose", "slate"]
MediaKind = Literal["track", "film", "image"]
PinKind = Literal["image", "track", "video"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Registration(Input):
    email: EmailStr
    username: Handle
    password: str = Field(min_length=8, max_length=128)


class Credentials(Input):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class VerificationInput(Input):
    token: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    password: str = Field(min_length=1, max_length=128)


class ProfilePatch(Input):
    name: Text = Field(min_length=1, max_length=80)
    bio: Text = Field("", max_length=600)


class CollectionInput(Input):
    title: Text = Field(min_length=1, max_length=120)
    description: Text = Field("", max_length=600)
    public: bool = False


class BoardInput(Input):
    title: Text = Field(min_length=1, max_length=120)
    description: Text = Field("", max_length=2000)
    tags: Tags = Field(default_factory=list)
    theme: Theme = "blue"
    visibility: Visibility = "private"


class ItemPatch(Input):
    note: Text = Field("", max_length=1500)
    tags: Tags = Field(default_factory=list)


class CatalogAdd(Input):
    kind: Literal["track", "film"]
    external_id: str = Field(pattern=r"^(demo-[a-z0-9-]+|[0-9]{1,20})$")


class ImageImport(Input):
    url: Text = Field(min_length=1, max_length=2048)
    title: Text = Field("Изображение", min_length=1, max_length=160)


class Destination(Input):
    board_id: str = Field(min_length=32, max_length=32)


class Reorder(Input):
    item_id: str = Field(min_length=32, max_length=32)
    position: int = Field(ge=0)
    version: int = Field(ge=0)


class Invite(Input):
    username: Handle


class InviteReply(Input):
    accept: bool


class CommentInput(Input):
    text: Text = Field(min_length=1, max_length=2000)


class ReportInput(Input):
    kind: Literal["board", "comment"]
    object_id: str = Field(min_length=32, max_length=32)
    reason: Text = Field(min_length=3, max_length=1000)


class Moderation(Input):
    action: Literal["dismiss", "hide", "restore", "delete", "block", "unblock"]
    reason: Text = Field(min_length=3, max_length=1000)
