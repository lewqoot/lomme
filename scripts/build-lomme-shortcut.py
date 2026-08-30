#!/usr/bin/env python3
"""Build the unsigned, shareable Lomme Apple Shortcut workflow.

The generated workflow contains only a placeholder. A personal quick-entry key
is supplied by the user during import and is used only as the value of the
Authorization header.
"""

from __future__ import annotations

import argparse
import plistlib
import uuid
from pathlib import Path


ENDPOINT = "https://lomme-production.up.railway.app/api/v1/quick?q="
KEY_PLACEHOLDER = "LOMME_PERSONAL_KEY"
OBJECT_REPLACEMENT = "\ufffc"


def action_output(output_uuid: str, output_name: str) -> dict[str, str]:
    return {
        "OutputName": output_name,
        "OutputUUID": output_uuid,
        "Type": "ActionOutput",
    }


def token_string(
    value: str,
    attachments: dict[str, dict[str, str]] | None = None,
) -> dict[str, object]:
    token_value: dict[str, object] = {"string": value}
    if attachments:
        token_value["attachmentsByRange"] = attachments
    return {
        "Value": token_value,
        "WFSerializationType": "WFTextTokenString",
    }


def dictionary_text(value: str) -> dict[str, object]:
    return token_string(value)


def build_workflow(
    *,
    include_import_question: bool = True,
    fixed_input: str | None = None,
    include_result: bool = True,
    endpoint: str = ENDPOINT,
) -> dict[str, object]:
    ask_uuid = str(uuid.uuid4()).upper()
    url_uuid = str(uuid.uuid4()).upper()
    key_uuid = str(uuid.uuid4()).upper()
    request_uuid = str(uuid.uuid4()).upper()

    if fixed_input is None:
        ask_action = {
            "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
            "WFWorkflowActionParameters": {
                "UUID": ask_uuid,
                "WFAskActionPrompt": "💸 Запиши, сколько потратил и на что",
            },
        }
        ask_output_name = "Запросить входные данные"
    else:
        ask_action = {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": ask_uuid,
                "WFTextActionText": fixed_input,
            },
        }
        ask_output_name = "Текст"

    url_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.url",
        "WFWorkflowActionParameters": {
            "UUID": url_uuid,
            "WFURLActionURL": token_string(
                endpoint + OBJECT_REPLACEMENT,
                {
                    f"{{{len(endpoint)}, 1}}": action_output(
                        ask_uuid,
                        ask_output_name,
                    )
                },
            ),
        },
    }

    key_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "UUID": key_uuid,
            "WFTextActionText": KEY_PLACEHOLDER,
        },
    }

    authorization_value = token_string(
        "Bearer " + OBJECT_REPLACEMENT,
        {"{7, 1}": action_output(key_uuid, "Текст")},
    )
    request_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": request_uuid,
            "WFHTTPMethod": "GET",
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFItemType": 0,
                            "WFKey": dictionary_text("Authorization"),
                            "WFValue": authorization_value,
                        }
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
            "WFURL": token_string(
                OBJECT_REPLACEMENT,
                {"{0, 1}": action_output(url_uuid, "URL")},
            ),
        },
    }

    notification_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
        "WFWorkflowActionParameters": {
            "WFNotificationActionBody": token_string(
                OBJECT_REPLACEMENT,
                {"{0, 1}": action_output(request_uuid, "Содержимое URL")},
            ),
            "WFNotificationActionSound": False,
        },
    }

    actions = [ask_action, url_action, key_action, request_action]
    if include_result:
        actions.append(notification_action)

    workflow: dict[str, object] = {
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "4610",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 61440,
            "WFWorkflowIconStartColor": -23508481,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFAppContentItem",
            "WFAppStoreAppContentItem",
            "WFArticleContentItem",
            "WFContactContentItem",
            "WFDateContentItem",
            "WFEmailAddressContentItem",
            "WFFolderContentItem",
            "WFGenericFileContentItem",
            "WFImageContentItem",
            "WFiTunesProductContentItem",
            "WFLocationContentItem",
            "WFDCMapsLinkContentItem",
            "WFAVAssetContentItem",
            "WFPDFContentItem",
            "WFPhoneNumberContentItem",
            "WFRichTextContentItem",
            "WFSafariWebPageContentItem",
            "WFStringContentItem",
            "WFURLContentItem",
        ],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["WFWorkflowTypeShowInSearch"],
    }
    if include_import_question:
        workflow["WFWorkflowImportQuestions"] = [
            {
                "ActionIndex": 2,
                "Category": "Parameter",
                "DefaultValue": KEY_PLACEHOLDER,
                "ParameterKey": "WFTextActionText",
                "Text": "Личный ключ Lomme",
            }
        ]
    return workflow


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path("dist-shortcut/Lomme — записать трату.wflow"),
    )
    parser.add_argument(
        "--without-import-question",
        action="store_true",
        help="Build a local structure-check workflow without the import sheet.",
    )
    parser.add_argument(
        "--fixed-input",
        help="Use a fixed first text action instead of prompting (test only).",
    )
    parser.add_argument(
        "--omit-result",
        action="store_true",
        help="Leave the network response as the shortcut output (test only).",
    )
    parser.add_argument(
        "--endpoint",
        default=ENDPOINT,
        help="Override the request endpoint (local verification only).",
    )
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as output:
        plistlib.dump(
            build_workflow(
                include_import_question=not args.without_import_question,
                fixed_input=args.fixed_input,
                include_result=not args.omit_result,
                endpoint=args.endpoint,
            ),
            output,
            fmt=plistlib.FMT_BINARY,
        )
    print(args.output.resolve())


if __name__ == "__main__":
    main()
