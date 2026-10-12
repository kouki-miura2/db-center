import { LIMITS, TERMS_VERSION } from 'utils'

// The terms of service and privacy policy ("総論 > 共通ルール > 同意", "各論 > データ保持・プライバシー").
// A draft written from the spec: the operator checks it for legal issues before publishing; it
// has not been legally reviewed. Raise `TERMS_VERSION` (`packages/utils`) whenever either changes.

const OPERATOR = import.meta.env.VITE_OPERATOR_NAME || '（運営者名）'
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || '（お問い合わせ先）'

export interface LegalDocument {
  title: string
  intro: string
  sections: { heading: string; paragraphs: string[] }[]
}

export const TERMS: LegalDocument = {
  title: '利用規約',
  intro: `この利用規約（以下「本規約」）は、${OPERATOR}（以下「運営者」）が提供する db-center（以下「本サービス」）の利用条件を定めるものです。利用者は、本規約に同意したうえで本サービスを利用するものとします。`,
  sections: [
    {
      heading: '第1条（利用登録）',
      paragraphs: [
        '本サービスは、Google アカウントでログインし、本規約とプライバシーポリシーに同意してユーザー名を登録した方が利用できます。',
        '利用者は、自身の Google アカウントを適切に管理するものとし、第三者に利用させてはなりません。',
      ],
    },
    {
      heading: '第2条（プロダクトとデータ）',
      paragraphs: [
        '利用者が登録したプロダクト・データベース設計・データベース接続情報などのデータ（以下「利用者データ」）は、利用者およびそのプロダクトの参加者に帰属します。',
        'プロダクトのオーナーは、参加者の招待・除外を含め、プロダクトの管理に責任を負います。',
      ],
    },
    {
      heading: '第3条（ビルド・マイグレーション）',
      paragraphs: [
        '本サービスが出力する DDL スクリプト・差分スクリプト、および接続先データベースへの自動ビルド・自動マイグレーションは、利用者の判断と責任で実行するものとします。',
        '実行の前に、接続先データベースのバックアップを取得し、内容を確認してください。運営者は、実行の結果生じたデータの損失・破損について責任を負いません。',
      ],
    },
    {
      heading: '第4条（禁止事項）',
      paragraphs: [
        '利用者は、法令または公序良俗に反する行為、他者の権利を侵害する行為、本サービスの運営を妨げる行為、不正アクセスやその試み、権限のないデータベースへの接続、その他運営者が不適切と判断する行為をしてはなりません。',
      ],
    },
    {
      heading: '第5条（サービスの変更・停止）',
      paragraphs: [
        '運営者は、保守・障害・その他の理由により、事前の通知なく本サービスの全部または一部を変更・停止することがあります。',
      ],
    },
    {
      heading: '第6条（退会）',
      paragraphs: [
        '利用者は、いつでも退会できます。オーナーであるプロダクトがある場合は、先にそのプロダクトを削除する必要があります。',
        '退会すると、参加しているプロダクトから退出します。利用者が作成した設計・実行履歴は、プロダクトに残ります。',
      ],
    },
    {
      heading: '第7条（免責）',
      paragraphs: [
        '運営者は、本サービスに事実上または法律上の瑕疵がないことを保証しません。運営者は、本サービスの利用により利用者に生じた損害について、運営者の故意または重大な過失による場合を除き、責任を負いません。',
      ],
    },
    {
      heading: '第8条（本規約の変更）',
      paragraphs: [
        '運営者は、必要に応じて本規約を変更できます。変更後は、次回のログイン時に改めて同意をお願いし、同意するまで本サービスを利用できません。',
      ],
    },
    {
      heading: '第9条（準拠法・管轄）',
      paragraphs: [
        '本規約は日本法に準拠します。本サービスに関する紛争は、運営者の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。',
      ],
    },
    {
      heading: 'お問い合わせ',
      paragraphs: [`${OPERATOR}　${CONTACT}`],
    },
  ],
}

export const PRIVACY: LegalDocument = {
  title: 'プライバシーポリシー',
  intro: `${OPERATOR}（以下「運営者」）は、db-center（以下「本サービス」）における利用者の情報を、以下のとおり取り扱います。`,
  sections: [
    {
      heading: '1. 取得する情報',
      paragraphs: [
        'Google アカウントの ID とメールアドレス、利用者が入力したユーザー名。Google のプロフィール名・写真は保存しません。',
        '招待のために入力されたメールアドレス。',
        '利用者が登録したプロダクト・データベース設計・データベース接続情報。接続情報のパスワードは暗号化して保存し、どの画面にも表示しません。',
        '操作の履歴（誰がいつ何をしたか）と、アクセスの記録（リクエストの日時・内容など）。',
      ],
    },
    {
      heading: '2. 利用目的',
      paragraphs: [
        '本人確認とログイン状態の維持、プロダクトへの招待と参加、本サービスの機能の提供、不正利用の防止、障害の調査と本サービスの改善のために利用します。',
      ],
    },
    {
      heading: '3. Cookie と端末への保存',
      paragraphs: [
        `ログイン状態の維持に Cookie を使います（有効期間 ${LIMITS.sessionDays} 日）。`,
        '表示したデータを、オフラインでも見られるよう端末（ブラウザ）に保存します。ログアウト・退会すると端末から削除します。',
      ],
    },
    {
      heading: '4. 保存期間',
      paragraphs: [
        `招待のメールアドレスは、招待の有効期限（${LIMITS.invitationHours} 時間）が過ぎたら削除します。`,
        `操作の履歴は ${Math.round(LIMITS.auditLogRetentionDays / 365)} 年間保存します。`,
        `削除したプロダクト・データベースは、${LIMITS.deletedRetentionDays} 日後に配下のデータとともに完全に削除します。`,
        '退会すると、Google アカウントの ID とメールアドレスを削除し、ユーザー名は「退会したユーザー」と表示します。',
      ],
    },
    {
      heading: '5. 第三者への提供・委託',
      paragraphs: [
        '法令に基づく場合を除き、本人の同意なく第三者に提供しません。',
        '本サービスの運営のため、Cloudflare, Inc.（サーバー・データの保管）と Google LLC（Google アカウントでのログイン）のサービスを利用します。これらの事業者は日本国外でデータを取り扱うことがあります。',
        '同じプロダクトの参加者には、利用者のユーザー名と、プロダクト内での操作の履歴が表示されます。',
      ],
    },
    {
      heading: '6. 安全管理',
      paragraphs: [
        '通信の暗号化、パスワードの暗号化、アクセス権限の管理など、情報の漏えい・滅失を防ぐための措置を講じます。',
      ],
    },
    {
      heading: '7. 開示・訂正・削除',
      paragraphs: [
        '退会により、ご自身の Google アカウントの情報を削除できます。そのほかの開示・訂正・利用停止のご請求は、お問い合わせ先までご連絡ください。',
      ],
    },
    {
      heading: '8. 改定',
      paragraphs: ['本ポリシーを改定したときは、次回のログイン時に改めて同意をお願いします。'],
    },
    {
      heading: 'お問い合わせ',
      paragraphs: [`${OPERATOR}　${CONTACT}`],
    },
  ],
}

/** Shown with both documents. */
export const LEGAL_VERSION = TERMS_VERSION
