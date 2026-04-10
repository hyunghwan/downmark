# Rendering Preview

이 문서는 Downmark의 렌더링을 한 번에 확인하려고 만든 샘플입니다.

문장 안에서 `inline code`가 plain text와 얼마나 구분되는지,
그리고 ~~strike~~ / ~~취소선~~ 이 충분히 눈에 띄는지 먼저 봐주세요.

`code` 뒤에 쉼표, `snippet` 뒤에 마침표.
괄호 안의 (`inline`) 코드와 ~~삭제된 문장~~도 같이 확인해보면 좋아요.

## Inline Stress Test

- 일반 텍스트와 `inline code`가 한 줄에 섞일 때
- 한국어와 `mixed-code-value`가 같이 있을 때
- `snake_case`, `camelCaseValue`, `kebab-case-value`
- ~~old API~~ 대신 `newApi()` 사용
- `npm run build` 후 ~~broken~~ 상태가 아닌지 확인
- 링크와 함께: [OpenAI](https://openai.com), `fetch("/api/preview")`, ~~legacy~~

## Emphasis

이 문장에는 **bold**, _italic_, ~~strike~~, 그리고 `inline code`가 모두 들어 있습니다.

## Lists

- 첫 번째 항목
- 두 번째 항목 with `inline`
- 세 번째 항목 with ~~deprecated~~ flag

1. ordered item one
2. ordered item two with `const value = 1`
3. ordered item three with ~~removed~~ note

- [ ] 체크박스 with `todo()`
- [x] 완료된 항목 with ~~old copy~~ replaced

## Quote

> 인용문 안의 `inline code`
>
> ~~더 이상 유효하지 않은 문장~~

## Image

아래 이미지는 원격 URL 이미지 렌더링 확인용입니다.

![Ocean cliffs at golden hour](https://plus.unsplash.com/premium_photo-1775466874808-d76d3b0ec1e1?q=80&w=2124&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D)

## Table

| Section | Example | Status |
| --- | --- | --- |
| Inline code | `renderInlineCode()` | good |
| Strike | ~~old label~~ | check |
| Mixed | `token` + ~~legacy~~ | inspect |
| Command | `Cmd/Ctrl -` | zoom out |
| Command | `Cmd/Ctrl +` | zoom in |

## Code Block

```ts
function previewRender(state: "ok" | "warn") {
  if (state === "warn") {
    return "Check inline code and strike visibility.";
  }

  return "Rendering looks good.";
}
```

---

마지막 줄에서도 `inline code`, ~~strike~~, **bold**가 자연스럽게 보이면 성공입니다.
