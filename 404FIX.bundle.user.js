// ==UserScript==
// @name         Shikimori 404 Fix
// @namespace    http://tampermonkey.net/
// @version      2.5.2
// @description  Fetch anime info and render 404 pages.
// @author       404FT
// @match        https://shikimori.one/*
// @match        https://shikimori.io/*
// @match        https://shiki.one/*
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/555555/Shikimori%20404%20Fix.user.js
// @updateURL https://update.greasyfork.org/scripts/555555/Shikimori%20404%20Fix.meta.js
// ==/UserScript==

(function () {
	"use strict";

	// Конфигурация
	const CONFIG = {
		DEBUG_MODE: true, // Включает/выключает подробные логи в консоли
		SITE_NAME: window.location.origin,
		DOMAIN_NAME: window.location.hostname, // Вернет "shiki.one"
		RATE_LIMIT_MS: 200, // Интервал между запросами к API (1000ms / 5 RPS = 200ms)
		RELATED_VISIBLE_COUNT: 5, // Сколько связанных произведений показывать сразу
		SIMILAR_LIMIT: 7, // Сколько похожих аниме показывать
		COMMENTS_LIMIT: 50, // Макс. кол-во загружаемых комментариев
		USE_DONOR_CSS: true, // true - брать custom_css с донорской страницы, false - использовать старый метод API
		USER_AGENT: "TampermonkeyScript/2.3", // User-Agent для запросов
		FETCH_TIMEOUT: 30000, // Таймаут для fetch запросов (30 секунд)
		TEMPLATE_URL:
			"https://raw.githubusercontent.com/404FT/404FIX/refs/heads/main/404FIX.html",
		DONOR_URL: "/animes/62616-sheng-dan-chuanqi-zhu-gong-de-shaizi",
        JIKAN_BASE: "https://api.jikan.moe/v4",
        JIKAN_CACHE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 дней
        // Список известных удалённых (18+) тайтлов (MAL ID == shikimori ID).
        DELETED_IDS_URL:
            "https://raw.githubusercontent.com/404FT/404FIX/refs/heads/main/deleted-ids.json",
        DELETED_IDS_TTL: 7 * 24 * 60 * 60 * 1000, // 7 дней
        // Перехват клика по известным удалённым ссылкам -> рендер без мелькания 404.
        INTERCEPT_KNOWN_DELETED: true,
	};

	// Часто используемые селекторы
	const SELECTORS = {
		ADD_TO_LIST: ".b-add_to_list",
		EXPANDED_OPTIONS: ".expanded-options",
		STATUS_NAME: ".status-name",
		TRIGGER: ".trigger",
		CSRF_TOKEN: 'meta[name="csrf-token"]',
	};

	// ANIME
	const GRAPHQL_QUERY_ANIME_MAIN = `
    query($id: String!) {
      animes(ids: $id, limit: 1, censored: false) {
        id malId name russian english kind score status episodes duration descriptionHtml
        airedOn { year month day date }
        releasedOn { year month day date }
        topic { id }
        poster { id originalUrl mainUrl miniAltUrl }
        genres { id name russian kind }
        studios { id name imageUrl }
        scoresStats { score count }
        statusesStats { status count }

        fandubbers
        fansubbers

        videos { id url name kind playerUrl imageUrl }
        screenshots { id originalUrl x166Url x332Url }
        externalLinks { id kind url }
      }
    }`;

	const GRAPHQL_QUERY_ANIME_DETAILS = `
    query($id: String!) {
      animes(ids: $id, limit: 1, censored: false) {
        id
        personRoles {
          id rolesRu rolesEn
          person { id name russian url image: poster { id mainUrl originalUrl miniAltUrl } }
        }
        characterRoles {
          id rolesRu rolesEn
          character { id name russian url image: poster { id mainUrl originalUrl miniAltUrl } }
        }
        related {
          id relationKind relationText
          anime { id name russian kind url episodes airedOn { year } poster { id mainUrl originalUrl miniAltUrl } }
          manga { id name russian kind url volumes chapters airedOn { year } poster { id mainUrl originalUrl miniAltUrl } }
        }
      }
    }`;

	// MANGA
	const GRAPHQL_QUERY_MANGA_MAIN = `
    query($id: String!) {
      mangas(ids: $id, limit: 1, censored: false) {
        id malId name russian english kind score status volumes chapters descriptionHtml
        airedOn { year month day date }
        releasedOn { year month day date }
        topic { id }
        poster { id originalUrl mainUrl miniAltUrl }
        genres { id name russian kind }
        publishers { id name }
        scoresStats { score count }
        statusesStats { status count }
        externalLinks { id kind url }
      }
    }`;

	const GRAPHQL_QUERY_MANGA_DETAILS = `
    query($id: String!) {
      mangas(ids: $id, limit: 1, censored: false) {
        id
        personRoles {
          id rolesRu rolesEn
          person { id name russian url image: poster { id mainUrl originalUrl miniAltUrl } }
        }
        characterRoles {
          id rolesRu rolesEn
          character { id name russian url image: poster { id mainUrl originalUrl miniAltUrl } }
        }
        related {
          id relationKind relationText
          anime { id name russian kind url episodes airedOn { year } poster { id mainUrl originalUrl miniAltUrl } }
          manga { id name russian kind url volumes chapters airedOn { year } poster { id mainUrl originalUrl miniAltUrl } }
        }
      }
    }`;

	const ANIME_HTML_TEMPLATE = `
    <!DOCTYPE html> <html data-color-mode="light"> <head> <meta charset="utf-8" /> <meta content="IE=edge,chrome=1" http-equiv="X-UA-Compatible" /> <meta content="width=device-width, initial-scale=1.0" name="viewport" /> <link href="/favicon.ico" rel="icon" type="image/x-icon" /> <link href="/favicons/favicon-16x16.png" rel="icon" sizes="16x16" type="image/png" /> <link href="/favicons/favicon-32x32.png" rel="icon" sizes="32x32" type="image/png" /> <link href="/favicons/favicon-96x96.png" rel="icon" sizes="96x96" type="image/png" /> <link href="/favicons/favicon-192x192.png" rel="icon" sizes="192x192" type="image/png" /> <link href="/favicons/manifest.json" rel="manifest" /> <link href="/favicons/apple-touch-icon-57x57.png" rel="apple-touch-icon" sizes="57x57" /> <link href="/favicons/apple-touch-icon-60x60.png" rel="apple-touch-icon" sizes="60x60" /> <link href="/favicons/apple-touch-icon-72x72.png" rel="apple-touch-icon" sizes="72x72" /> <link href="/favicons/apple-touch-icon-76x76.png" rel="apple-touch-icon" sizes="76x76" /> <link href="/favicons/apple-touch-icon-114x114.png" rel="apple-touch-icon" sizes="114x114" /> <link href="/favicons/apple-touch-icon-120x120.png" rel="apple-touch-icon" sizes="120x120" /> <link href="/favicons/apple-touch-icon-144x144.png" rel="apple-touch-icon" sizes="144x144" /> <link href="/favicons/apple-touch-icon-152x152.png" rel="apple-touch-icon" sizes="152x152" /> <link href="/favicons/apple-touch-icon-180x180.png" rel="apple-touch-icon" sizes="180x180" /> <link color="#123" href="/favicons/safari-pinned-tab.svg" rel="mask-icon" /> <meta content="#000000" name="theme-color" /> <meta content="#000000" name="msapplication-TileColor" /> <meta content="/favicons/ms-icon-144x144.png" name="msapplication-TileImage" /> <meta content="/favicons/browserconfig.xml" name="msapplication-config" /> <link href="/favicons/opera-icon-228x228.png" rel="icon" sizes="228x228" /> <link href="/search.xml" rel="search" title="{{DOMAIN_NAME}}" type="application/opensearchdescription+xml" /> <link href="https://fonts.googleapis.com" rel="preconnect" /> <link href="https://fonts.gstatic.com" rel="preconnect" /> <link href="https://fonts.googleapis.com" rel="preconnect" /> <link href="https://fonts.gstatic.com" rel="preconnect" /> <link href="https://dere.{{DOMAIN_NAME}}" rel="preconnect" /> <meta content="video.tv_show" property="og:type" /> <meta content="{{EN_NAME}}" property="og:title" /> <meta content="http://cdn.anime-recommend.ru/previews/{{MYANIMELIST_ID}}.jpg" property="og:image" /> <meta content="image/jpeg" property="og:image:type" /> <meta content="1200" property="og:image:width" /> <meta content="630" property="og:image:height" /> <meta content="{{SITE_NAME}}/animes/{{ID}}" property="og:url" /> <meta content="Шикимори" property="og:site_name" /> <meta content="1440" property="video:duration" /> <meta content="2024-03-22" property="video:release_date" /> <meta content="Приключения" property="video:tag" /> <meta content="Драма" property="video:tag" /> <meta content="Фэнтези" property="video:tag" /> <meta content="Сёнен" property="video:tag" /> <meta content="summary_large_image" property="twitter:card" /> <meta content="{{EN_NAME}}" name="twitter:title" /> <meta content="http://cdn.anime-recommend.ru/previews/{{MYANIMELIST_ID}}.jpg" name="twitter:image" /> <meta content="Шикимори" name="twitter:site" /> <title>{{EN_NAME}} / Аниме</title> <meta name="csrf-param" content="authenticity_token" /> <meta name="csrf-token" content="{{AUTHENTICITY_TOKEN}}" /> <script nomodule="" src="/outdated-browser.js"></script> {{FETCHED_CSS}} {{FETCHED_JS}} <script> document.addEventListener('DOMContentLoaded', function() { // для совместимости счётчиков с турболинками $(document).on('turbolinks:before-visit', function() { window.turbolinks_referer = location.href; console.log("turbolinks_referer was linked successfully!"); }); }); </script> </head> <body class="p-animes p-animes-show p-db_entries p-db_entries-show x1200" data-camo_url="https://camo-v3.{{DOMAIN_NAME}}/" data-env="production" data-faye="[&quot;/private-{{USER_ID}}&quot;]" data-faye_url="https://faye-v2.{{DOMAIN_NAME}}/" data-js_export_supervisor_keys="[&quot;user_rates&quot;,&quot;topics&quot;,&quot;comments&quot;,&quot;polls&quot;]" data-locale="ru" data-localized_genres="ru" data-localized_names="ru" data-server_time="2025-11-03T17:53:43+03:00" data-user="{&quot;id&quot;:{{USER_ID}},&quot;url&quot;:&quot;https://{{DOMAIN_NAME}}/{{USER_NICK}}&quot;,&quot;is_moderator&quot;:false,&quot;ignored_topics&quot;:[],&quot;ignored_users&quot;:[],&quot;is_day_registered&quot;:true,&quot;is_week_registered&quot;:true,&quot;is_comments_auto_collapsed&quot;:true,&quot;is_comments_auto_loaded&quot;:true}" id="animes_show"> <style id="custom_css" type="text/css"></style> <div id="outdated"></div> <header class="l-top_menu-v2"> <div class="menu-logo"> <a class="logo-container" href="{{SITE_NAME}}" title="Шикимори"> <div class="glyph"></div> <div class="logo"></div> </a> <div class="menu-dropdown main"> <span class="menu-icon trigger mobile" tabindex="-1"></span> <span class="submenu-triangle icon-{{CONTENT_TYPE}}" tabindex="0"> <span>{{SECTION_NAME}}</span> </span> <div class="submenu"> <div class="legend">База данных</div> <a class="icon-anime" href="/animes" tabindex="-1" title="Аниме">Аниме</a> <a class="icon-manga" href="/mangas" tabindex="-1" title="Манга">Манга</a> <a class="icon-ranobe" href="/ranobe" tabindex="-1" title="Ранобэ">Ранобэ</a> <div class="legend">Сообщество</div> <a class="icon-forum" href="/forum" tabindex="-1" title="Форум">Форум</a> <a class="icon-clubs" href="/clubs" tabindex="-1" title="Клубы">Клубы</a> <a class="icon-collections" href="/collections" tabindex="-1" title="Коллекции">Коллекции</a> <a class="icon-critiques" href="/forum/critiques" tabindex="-1" title="Рецензии">Рецензии</a> <a class="icon-articles" href="/articles" tabindex="-1" title="Статьи">Статьи</a> <a class="icon-users" href="/users" tabindex="-1" title="Пользователи">Пользователи</a> <div class="legend">Разное</div> <a class="icon-contests" href="/contests" tabindex="-1" title="Турниры">Турниры</a> <a class="icon-calendar" href="/ongoings" tabindex="-1" title="Календарь">Календарь</a> <div class="legend">Информация</div> <a class="icon-info" href="/about" tabindex="-1" title="О сайте">О сайте</a> <a class="icon-socials" href="/forum/site/270099-my-v-sotsialnyh-setyah" tabindex="-1" title="Мы в соц. сетях">Мы в соц. сетях</a> <a class="icon-moderation" href="/moderations" tabindex="-1" title="Модерация">Модерация</a> </div> </div> </div> <div class="menu-icon search mobile"></div> <div class="global-search" data-autocomplete_anime_url="/animes/autocomplete/v2" data-autocomplete_character_url="/characters/autocomplete/v2" data-autocomplete_manga_url="/mangas/autocomplete/v2" data-autocomplete_person_url="/people/autocomplete/v2" data-autocomplete_ranobe_url="/ranobe/autocomplete/v2" data-default-mode="{{CONTENT_TYPE}}" data-search_anime_url="/animes" data-search_character_url="/characters" data-search_manga_url="/mangas" data-search_person_url="/people" data-search_ranobe_url="/ranobe"> <label class="field"> <input placeholder="Поиск..." type="text" /> <span class="clear" tabindex="-1"></span> <span class="hotkey-marker"></span> <span class="search-marker"></span> </label> <div class="search-results"> <div class="inner"></div> </div> </div> <a class="menu-icon forum desktop" href="/forum" title="Форум"></a> <a class="menu-icon contest" data-count="?" href="/contests/current" title="Текущий турнир"></a> <div class="menu-dropdown profile"> <span tabindex="0"> <a class="submenu-triangle" href="/{{USER_NICK}}"> <img alt="{{USER_NICK}}" src="{{USER_AVATAR_X48}}" srcset="{{USER_AVATAR_X80}} 2x" title="{{USER_NICK}}" /> <span class="nickname">{{USER_NICK}}</span> </a> </span> <div class="submenu"> <div class="legend">Аккаунт</div> <a class="icon-profile" href="/{{USER_NICK}}" tabindex="-1" title="Профиль"> <span class="text">Профиль</span> </a> <a class="icon-anime_list" href="/{{USER_NICK}}/list/anime" tabindex="-1" title="Список аниме"> <span class="text">Список аниме</span> </a> <a class="icon-manga_list" href="/{{USER_NICK}}/list/manga" tabindex="-1" title="Список манги"> <span class="text">Список манги</span> </a> <a class="icon-mail" href="/{{USER_NICK}}/dialogs" tabindex="-1" title="Почта"> <span class="text">Почта</span> </a> <a class="icon-achievements" href="/{{USER_NICK}}/achievements" tabindex="-1" title="Достижения"> <span class="text">Достижения</span> </a> <a class="icon-clubs" href="/{{USER_NICK}}/clubs" tabindex="-1" title="Клубы"> <span class="text">Клубы</span> </a> <a class="icon-settings" href="/{{USER_NICK}}/edit/account" tabindex="-1" title="Настройки"> <span class="text">Настройки</span> </a> <div class="legend">Сайт</div> <a class="icon-site_rules" href="/forum/site/588641-pravila-sayta-v2" tabindex="-1" title="Правила сайта"> <span class="text">Правила сайта</span> </a> <a class="icon-faq" href="/clubs/1093-faq-chasto-zadavaemye-voprosy" tabindex="-1" title="FAQ"> <span class="text">FAQ</span> </a> <a class="icon-sign_out" data-method="delete" href="/users/sign_out" tabindex="-1">Выход</a> </div> </div> </header> <section class="l-page" itemscope="" itemtype="http://schema.org/Movie"> <div> <div class="menu-toggler"> <div class="toggler"></div> </div> <header class="head"> <meta content="Sousou no Frieren" itemprop="name" /> <h1>{{RU_NAME}} <span class="b-separator inline">/</span> {{EN_NAME}} </h1> <div class="b-breadcrumbs" itemscope="" itemtype="https://schema.org/BreadcrumbList"> <span itemprop="itemListElement" itemscope="" itemtype="https://schema.org/ListItem"> <a class="b-link" href="/animes" itemprop="item" title="Аниме"> <span itemprop="name">Аниме</span> </a> <meta content="0" itemprop="position" /> </span> <span itemprop="itemListElement" itemscope="" itemtype="https://schema.org/ListItem"> <a class="b-link" href="/animes/kind/tv" itemprop="item" title="Сериалы"> <span itemprop="name">Сериалы</span> </a> <meta content="1" itemprop="position" /> </span> <span itemprop="itemListElement" itemscope="" itemtype="https://schema.org/ListItem"> <a class="b-link" href="/animes?genre=27-Shounen" itemprop="item" title="Сёнен"> <span itemprop="name">Сёнен</span> </a> <meta content="2" itemprop="position" /> </span> </div> </header> <div class="menu-slide-outer x199"> <div class="menu-slide-inner"> <div class="l-content"> <div class="block"> <meta content="/animes/{{ID}}" itemprop="url" /> <meta content="Sousou no Frieren" itemprop="headline" /> <meta content="Провожающая в последний путь Фрирен" itemprop="alternativeHeadline" /> <meta content="2023-09-29" itemprop="dateCreated" /> <div class="b-db_entry"> <div class="c-image"> <div class="cc block"> <div class="c-poster"> <div class="b-db_entry-poster b-image unprocessed" data-href="{{POSTER}}" data-poster_id="0"> <meta content="{{POSTER}}" itemprop="image" /> <picture> <source srcset="{{POSTER}} 1x, {{POSTER}} 2x" type="image/webp" /> <img alt="{{RU_NAME}}" height="318" src="{{POSTER}}" srcset="{{POSTER}} 2x" width="225" /> </picture> <span class="marker"> <span class="marker-text">705x995</span> </span> </div> </div> <div class="c-actions"> <div class="b-subposter-actions"> <a class="b-subposter-action new_comment b-tooltipped unprocessed to-process" data-direction="top" data-dynamic="day_registered" data-text="Комментировать" title="Комментировать"></a> <a class="b-subposter-action new_review b-tooltipped unprocessed to-process" data-direction="top" data-dynamic="day_registered" data-text="Написать отзыв" href="/animes/{{ID}}/reviews/new" title="Написать отзыв"></a> <a class="b-subposter-action new_critique b-tooltipped unprocessed to-process" data-direction="top" data-dynamic="week_registered" data-text="Написать рецензию" href="/{{CONTENT_TYPE_M}}/{{ID}}/critiques/new?critique%5Btarget_id%5D={{ID}}&amp;critique%5Btarget_type%5D={{CONTENT_TYPE_UP}}&amp;critique%5Buser_id%5D={{USER_ID}}" title="Написать рецензию"></a> <a class="b-subposter-action fav-add b-tooltipped unprocessed to-process" data-add_text="Добавить в избранное" data-direction="top" data-dynamic="authorized" data-kind="" data-remote="true" data-remove_text="Удалить из избранного" data-type="json" href="/api/favorites/{{CONTENT_TYPE_UP}}/{{ID}}"></a> <a class="b-subposter-action edit b-tooltipped unprocessed to-process" data-direction="top" data-dynamic="authorized" data-text="Редактировать" href="/{{CONTENT_TYPE_M}}/{{ID}}/edit" title="Редактировать"></a> </div> </div> </div> {{USER_RATE_BUTTON}} {{USER_RATE_EXTRA}} </div> <div class="c-about"> <div class="cc"> <div class="c-info-left"> <div class="subheadline">Информация</div> <div class="block"> <div class="b-entry-info"> <div class='line-container'> <div class='line'> <div class='key'>Тип:</div> <div class='value'>{{TYPE}}</div> </div> </div> {{COUNT_BLOCK}} <div class='line-container'> <div class='line'> {{DURATION_BLOCK}} </div> </div> <div class='line-container'> <div class='line'> <div class='key'>Статус:</div> <div class='value'> <span class="b-anime_status_tag {{STATUS_CLASS}}" data-text="{{STATUS}}"></span> &nbsp; <span class="b-tooltipped dotted mobile unprocessed" data-direction="right" title="{{DATE_TOOLTIP}}">{{DATE_RANGE}}</span> </div> </div> </div> <div class='line-container'> <div class='line'> {{GENRES}} </div> </div> <div class='line-container'> <div class='line'> <div class='key'>Рейтинг:</div> <div class='value'> <span class="b-tooltipped dotted mobile unprocessed" data-direction="right" title="{{RATING_TOOLTIP}}">{{RATING}}</span> </div> </div> </div> <div class='line-container'> <div class='line'> <div class='key'>Первоисточник:</div> <div class='value'>{{SOURCE}}</div> </div> </div> <div class='line-container'> <div class='line'> <div class='key'>Альтернативные названия:</div> <div class='value'> <span class="other-names to-process" data-clickloaded-url="/{{CONTENT_TYPE_M}}/{{ID}}/other_names" data-dynamic="clickloaded"> <span>···</span> </span> </div> </div> </div> <div class="additional-links"> <div class="line-container"> <div class="key">У {{ENTITY_NOUN}}:</div> <span class="linkeable" data-href="/{{CONTENT_TYPE_M}}/{{ID}}/critiques">--- рецензия</span> <span class="linkeable" data-href="/{{CONTENT_TYPE_M}}/{{ID}}/reviews">--- отзывов</span> <span class="linkeable" data-href="/forum/animanga/anime-{{ID}}/{{TOPIC_ID}}-obsuzhdenie-anime">{{COMMENTS_COUNT}} комментариев</span> <span class="linkeable" data-href="/{{CONTENT_TYPE_M}}/{{ID}}/coub">---</span> </div> </div> </div> </div> </div> <div class="c-info-right"> <div class="block" itemprop="aggregateRating" itemscope itemtype="http://schema.org/AggregateRating"> <div class="subheadline m5">Рейтинг</div> <div class="scores"> <meta content="10" itemprop="bestRating" /> <meta content="{{SCORE}}" itemprop="ratingValue" /> <meta content="{{RATING_COUNT}}" itemprop="ratingCount" /> <div class="b-rate"> <div class="stars-container"> <div class="hoverable-trigger"></div> <div class="stars score score-{{SCORE_ROUND}}"></div> <div class="stars hover"></div> <div class="stars background"></div> </div> <div class="text-score"> <div class="score-value score-{{SCORE_ROUND}}">{{SCORE}}</div> <div class="score-notice">{{RATING_NOTICE}}</div> </div> </div> </div> </div> <div class="block contest_winners"> </div> <style> .studio-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; } </style> <div class="block"> <div class="subheadline">{{ORG_LABEL}}</div> <div class="studio-list"> {{ORGANIZATIONS}} </div> </div> </div> </div> </div> <div class="c-description"> <div class="subheadline m5">Описание</div> <div class="block"> <div class="b-lang_trigger" data-eng="eng" data-rus="рус"> <span>eng</span> </div> <div class="description-other" style="display: none"> <div class="text"> <div class="b-text_with_paragraphs">В разработке.</div> </div> <div class="b-source"> <div class="source"> <div class="key">Источник:</div> <div class="val"> <a class='b-link' href="http://myanimelist.net/anime/{{MYANIMELIST_ID}}">myanimelist.net</a> </div> </div> </div> </div> <div class="description-current"> <div class="text" itemprop="description"> <div class="b-text_with_paragraphs">{{DESCRIPTION}}</div> </div> <div class="b-source"> <div class="contributors"> <div class="key">Автор:</div> <div class="b-user16"> <span>Неизвестно</span> </div> </div> </div> </div> </div> </div> </div> <div class="cc-related-authors"> <div class="c-column block_m"> <div class="b-options-floated mobile-phone"> <span class="linkeable" data-href="/animes/{{ID}}/related">Напрямую</span> <span class="linkeable" data-href="/animes/{{ID}}/chronology">Хронология</span> <span class="linkeable" data-href="/animes/{{ID}}/franchise">Франшиза</span> </div> <div class="subheadline">Связанное</div> {{RELATED_CONTENT}} </div> <div class="c-column c-authors block_m"> <div class="subheadline"> <span class="linkeable" data-href="/animes/{{ID}}/staff">Авторы</span> </div> {{STAFF}} </div> </div> <div class="cc-characters"> <div class="c-characters m0"> <div class="subheadline"> <span class="linkeable" data-href="/animes/{{ID}}/characters">Главные герои</span> </div> {{MAIN_CHARACTERS}} </div> {{SUPPORTING_CHARACTERS}} </div> {{SCREENSHOTS_AND_VIDEOS}} <div class="block"> <div class="subheadline"> <span class="linkeable" data-href="/animes/{{ID}}/similar">Похожее</span> </div> {{SIMILAR_ANIMES}} </div> <div class="subheadline"> <a href="/forum/animanga/anime-{{ID}}/{{TOPIC_ID}}-obsuzhdenie-anime" title="Все комментарии"> Комментарии <div class="count">{{COMMENTS_COUNT}}</div> </a> </div> </div> <div class="to-process" data-dynamic="topic" data-faye="[&quot;/topic-{{TOPIC_ID}}&quot;]"> <div class="b-comments"> <div class="fix404-load-more b-link" data-topic="{{TOPIC_ID}}" data-total="{{COMMENTS_TOTAL}}" data-nextpage="{{COMMENTS_NEXT_PAGE}}" style="cursor:pointer;text-align:center;padding:12px;">Загрузить ещё {{COMMENTS_LOAD_STEP}} комментариев из {{COMMENTS_TOTAL}}</div> <div class="fix404-comments-list">{{COMMENTS}}</div> <div class="comments-hider">Скрыть {{COMMENTS_COUNT}} комментариев</div> <div class="comments-expander">Показать {{COMMENTS_COUNT}} комментариев</div> <div class="comments-collapser hidden">свернуть</div> </div> </div> <div class="editor-container"> <div class="b-options-floated"> <span class="action return-to-reply">назад</span> </div> <div class="subheadline">Твой комментарий</div> <form class="simple_form b-form new_comment" data-type="json" novalidate="novalidate" action="/api/comments" accept-charset="UTF-8" data-remote="true" method="post" > <input type="hidden" name="authenticity_token" value="{{AUTHENTICITY_TOKEN}}" autocomplete="off" /> <input name="frontend" type="hidden" value="true" /> <div class="b-input hidden comment_commentable_id"> <input class="hidden" autocomplete="off" type="hidden" value="{{TOPIC_ID}}" name="comment[commentable_id]" /> </div> <div class="b-input hidden comment_commentable_type"> <input class="hidden" autocomplete="off" type="hidden" value="Topic" name="comment[commentable_type]" /> </div> <div class="b-input hidden comment_is_offtopic"> <input class="hidden" autocomplete="off" type="hidden" value="false" name="comment[is_offtopic]" /> </div> <div class="b-shiki_editor shiki_editor-selector" data-dynamic="shiki_editor" data-field_name="comment[body]" > <div class="controls"> <aside class="buttons"> <div class="editor-controls"> <span class="editor-bold b-tooltipped" data-direction="top" original-title="Жирный" ></span> <span class="editor-italic b-tooltipped" data-direction="top" original-title="Курсив" ></span> <span class="editor-underline b-tooltipped" data-direction="top" original-title="Подчёркнутый" ></span> <span class="editor-strike b-tooltipped" data-direction="top" original-title="Зачёркнутый" ></span> <span class="editor-link b-tooltipped" data-direction="top" original-title="Ссылка" ></span> <span class="editor-image b-tooltipped" data-direction="top" original-title="Ссылка на картинку" ></span> <span class="editor-quote b-tooltipped" data-direction="top" original-title="Цитата" ></span> <span class="editor-spoiler b-tooltipped" data-direction="top" original-title="Спойлер" ></span> <label class="editor-file b-tooltipped" data-direction="top" original-title="Загрузить изображение" > <input type="file" /> </label> <span class="editor-smiley b-tooltipped" data-direction="top" original-title="Смайлик" ></span> </div> </aside> <aside class="markers"> <div class="b-offtopic_marker active off" data-text="оффтоп"></div> </aside> </div> <div class="smileys hidden" data-href="/comments/smileys" > <div class="ajax-loading" title="Загрузка..."></div> </div> <div class="links hidden hidden-block"> <label> <input type="radio" name="link_type" value="url" data-placeholder="Укажи адрес страницы..." /> <span>ссылка</span> </label> <label> <input type="radio" name="link_type" value="anime" data-placeholder="Укажи название аниме..." data-autocomplete="/animes/autocomplete" /> <span>аниме</span> </label> <label> <input type="radio" name="link_type" value="manga" data-placeholder="Укажи название манги..." data-autocomplete="/mangas/autocomplete" /> <span>манга</span> </label> <label> <input type="radio" name="link_type" value="ranobe" data-placeholder="Укажи название ранобэ..." data-autocomplete="/ranobe/autocomplete" /> <span>ранобэ</span> </label> <label> <input type="radio" name="link_type" value="character" data-placeholder="Укажи имя персонажа..." data-autocomplete="/characters/autocomplete" /> <span>персонаж</span> </label> <label> <input type="radio" name="link_type" value="person" data-placeholder="Укажи имя человека..." data-autocomplete="/people/autocomplete" /> <span>человек</span> </label> <div class="input-container"> <input type="text" name="link_value" value="" class="link-value ac_input" autocomplete="off" /> <div class="b-button ok" data-type="links">OK</div> </div> </div> <div class="images hidden hidden-block"> <span>Вставка изображения:</span> <div class="input-container"> <input type="text" name="image_value" value="" class="link-value" placeholder="Укажи адрес картинки..." /> <div class="b-button ok" data-type="images">OK</div> </div> </div> <div class="quotes hidden hidden-block"> <span>Цитирование пользователя:</span> <div class="input-container"> <input type="text" name="quote_value" value="" class="link-value ac_input" placeholder="Укажи имя пользователя..." data-autocomplete="/users/autocomplete" autocomplete="off" /> <div class="b-button ok" data-type="quotes">OK</div> </div> </div> <div class="b-upload_progress"> <div class="bar"></div> </div> <div class="body"> <div class="editor"> <div class="b-input text required comment_body"> <label class="text required control-label"> <abbr title="Обязательное поле">*</abbr> Текст </label> <textarea class="text required editor-area pastable" placeholder="Текст комментария" tabindex="0" data-upload_url="/api/user_images?linked_type=Comment" data-item_type="comment" name="comment[body]" ></textarea> </div> </div> <div class="preview"></div> </div> <footer> <input type="submit" name="commit" value="Написать" id="submit_907900.5100256373" class="btn-primary btn-submit btn" data-disable-with="Отправка…" autocomplete="off" tabindex="0" /> <div class="unpreview" tabindex="0">Вернуться к редактированию</div> <div class="b-button preview" data-preview_url="/comments/preview" tabindex="0" > Предпросмотр </div> <div class="hide">Скрыть</div> <div class="about-bb_codes"> <a href="/bb_codes" target="_blaNK" >примеры BBCode</a > </div> </footer> </div> </form> </div> </div> <aside class="l-menu"> <div class="b-animes-menu"> {{USER_RATINGS}} {{USER_STATUSES}} <div class="block"> <div class="subheadline m5">У друзей</div> </div> <div class="b-favoured"> <div class="subheadline"> <div class="linkeable" data-href="/animes/{{ID}}/favoured"> В избранном <div class="count">---</div> </div> </div> <div class="cc"> <div class="b-user c-column avatar"> <a class="avatar" href="/forum/site/610897-shikimori-404-fix" style="display: block; padding: 10px; text-align: center; color: #0066cc; text-decoration: none; overflow-wrap: anywhere;"> . </a> </div> </div> </div> <div class="block"> <div class="subheadline"> <div class="linkeable" data-href="/animes/{{ID}}/clubs"> В клубах <div class="count">---</div> </div> </div> <div class="b-clubs one-line"> <a href="/forum/site/610897-shikimori-404-fix" style="display: block; padding: 10px; text-align: center; color: #0066cc; text-decoration: none; overflow-wrap: anywhere;"> Если знаете как вернуть данную информацию напишите мне в топик скрипта на сайте </a> </div> </div> <div class="block"> <div class="subheadline m5"> <div class="linkeable" data-href="/animes/{{ID}}/collections"> В коллекциях <div class="count">---</div> </div> </div> <div class="block"> <div class="b-menu-line"> <span> <a class="b-link" href="/forum/site/610897-shikimori-404-fix" style="display: block; padding: 10px; text-align: center; color: #0066cc; text-decoration: none; overflow-wrap: anywhere;"> Если знаете как вернуть данную информацию напишите мне в топик скрипта на сайте </a> </span> </div> </div> </div> {{NEWS}} <div class="block"> <div class="subheadline m8">На других сайтах</div> {{EXTERNAL_LINKS}} </div> <div class="block"> <div class="subheadline m5">Субтитры</div> {{SUBTITLES}} </div> <div class="block"> <div class="subheadline m5">Озвучка</div> {{DUBBING}} </div> </div> </aside> </div> </div> </div> <footer class="l-footer"> <div class="copyright"> &copy; {{DOMAIN_NAME}}&nbsp; <span class="date">2011-2025</span> </div> <div class="links"> <a class="terms" href="/terms" tabindex="-1" title="Соглашение">Соглашение</a> <a class="for-right-holders" href="/for_right_holders" tabindex="-1" title="Для правообладателей">Для правообладателей</a> <a class="sitemap" href="/sitemap" tabindex="-1" title="Карта сайта">Карта сайта</a> </div> </footer> </section> <div class="b-shade"></div> <div class="b-to-top"> <div class="slide"></div> <div class="arrow"></div> </div> <div class="b-feedback"> <div class="hover-activator"></div> <span class="marker-positioner" data-action="/feedback" data-remote="true" data-type="html"> <div class="marker-text" data-text="Сообщить об ошибке"></div> </span> </div> <script id="js_export"> {{JS_EXPORT}} </script> <script> //<![CDATA[ window.gon={};gon.is_favoured=false; //]]> </script> </body> </html>
    `;

	// Утилиты
	const log = (...args) => console.log("[404FIX]", ...args);
	const debug = (...args) =>
		CONFIG.DEBUG_MODE && console.log("[404FIX]", ...args);
	const error = (...args) => console.error("[404FIX]", ...args);

	// Helper функции
	const isUserLoggedIn = (user) => user && user.USER_ID;

	// Fetch с таймаутом
	const fetchWithTimeout = async (url, options = {}, timeout = CONFIG.FETCH_TIMEOUT) => {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});
			clearTimeout(timeoutId);
			return response;
		} catch (err) {
			clearTimeout(timeoutId);
			if (err.name === 'AbortError') {
				throw new Error(`Request timeout after ${timeout}ms: ${url}`);
			}
			throw err;
		}
	};

	// Решает, имеет ли смысл повторять запрос. Повторяем только временные сбои:
	// таймаут, сетевые ошибки, 429 (rate-limit) и 5xx. Детерминированные 4xx — нет.
	const isRetryable = (err) => {
		const msg = err && err.message ? err.message : "";
		if (/timeout|Failed to fetch|NetworkError|load failed|terminated/i.test(msg))
			return true;
		const status = err && err.status;
		if (status === 429 || (status >= 500 && status <= 599)) return true;
		// Ошибки уровня GraphQL (200 OK, но в теле errors) считаем временными.
		if (/GQL errors/i.test(msg)) return true;
		return false;
	};

	// Повтор с экспоненциальной задержкой (по умолчанию 400 -> 800 -> 1600 мс).
	// Спасает от "перебоев" из-за rate-limit / 5xx / сетевых блипов.
	const withRetry = async (fn, { retries = 3, baseDelay = 400, label = "request" } = {}) => {
		let lastErr;
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				return await fn(attempt);
			} catch (err) {
				lastErr = err;
				if (attempt === retries || !isRetryable(err)) break;
				const delay = baseDelay * Math.pow(2, attempt);
				log(
					`🔁 Повтор «${label}» через ${delay}мс ` +
						`(попытка ${attempt + 1}/${retries}, причина: ${err.message})`,
				);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
		throw lastErr;
	};

	const closeAllExpandedMenus = () => {
		document.querySelectorAll(".expanded-options").forEach((el) => {
			el.style.display = "none";
			el.closest(".b-add_to_list")?.classList.remove("expanded");
		});
	};

	const safeExecute = (fn, fallback = null) => {
		try {
			return fn();
		} catch (e) {
			error("Safe execute error:", e);
			return fallback;
		}
	};

	const buildUrl = (type, path) => {
		const typeStr = type === "ranobe" ? "ranobe" : `${type}s`;
		return `/${typeStr}/${path}`;
	};

	// Вспомогательная функция для URL картинок
	// Если ссылка начинается с http, возвращает как есть. Иначе добавляет домен.
	const getFullUrl = (path) => {
		if (!path) return "";
		if (path.startsWith("http")) return path;
		return `${CONFIG.SITE_NAME}/${path}`;
	};

	let loaderInterval;
	let progressEl = null;
	// Тонкий прогресс-бар сверху (стиль NProgress) поверх приглушённой 404-страницы.
	// Разметку 404 НЕ трогаем — только слегка гасим её и кладём полосу сверху.
	const showLoader = () => {
		if (document.getElementById("fix404-progress")) return; // защита от дублей

		// Приглушаем исходную 404-страницу, чтобы было видно "идёт загрузка".
		const dialog = document.querySelector(".dialog");
		if (dialog) {
			dialog.style.transition = "opacity 0.2s ease";
			dialog.style.opacity = "0.35";
			dialog.style.pointerEvents = "none";
		}

		const bar = document.createElement("div");
		bar.id = "fix404-progress";
		bar.style.cssText =
			"position:fixed;top:0;left:0;height:3px;width:0%;z-index:2147483647;" +
			"background:linear-gradient(90deg,#ff5a6e,#ff8a9a);" +
			"box-shadow:0 0 8px rgba(255,90,110,0.7);" +
			"transition:width 0.2s ease;border-radius:0 2px 2px 0;";
		(document.body || document.documentElement).appendChild(bar);
		progressEl = bar;

		// "Trickle": плавно ползём к ~90%, последние проценты добиваем в hideLoader.
		let progress = 8;
		bar.style.width = progress + "%";
		loaderInterval = setInterval(() => {
			const remaining = 90 - progress;
			progress += Math.max(0.5, remaining * 0.08); // замедляемся ближе к 90%
			if (progress > 90) progress = 90;
			bar.style.width = progress.toFixed(1) + "%";
		}, 200);
	};

	const hideLoader = () => {
		clearInterval(loaderInterval);
		if (progressEl) {
			// Добиваем до 100% и убираем (обычно сразу следует document.write).
			progressEl.style.width = "100%";
			const el = progressEl;
			setTimeout(() => {
				el.style.transition = "opacity 0.25s ease";
				el.style.opacity = "0";
				setTimeout(() => el.remove(), 300);
			}, 150);
			progressEl = null;
		}
		log("Страница загружена, отображаем...");
	};

	/**
	 * Возвращает соответствующий оценке текст на Шикимори.
	 * @param {Number} score Оценка тайтла
	 * @returns На основе оценки возвращает соотствующий текст (напр. "Более-менее / Нормально / Великолепно").
	 */
	const getScoreText = (score) => {
		const s = Math.floor(Number(score));
		if (s < 1) return "Без оценки";
		if (s <= 1) return "Хуже некуда";
		if (s <= 2) return "Ужасно";
		if (s <= 3) return "Очень плохо";
		if (s <= 4) return "Плохо";
		if (s <= 5) return "Более-менее";
		if (s <= 6) return "Нормально";
		if (s <= 7) return "Хорошо";
		if (s <= 8) return "Отлично";
		if (s <= 9) return "Великолепно";
		return "Эпик вин!";
	};

	/**
	 * Преобразует статус из английского в русский и возвращает CSS класс
	 * @param {string} status - Статус на английском (released, ongoing, anons и т.д.)
	 * @returns {object} - {text: "Вышло", class: "released"}
	 */
	const getStatusInfo = (status) => {
		const statusMap = {
			released: { text: "Вышло", class: "released" },
			ongoing: { text: "Онгоинг", class: "ongoing" },
			anons: { text: "Анонс", class: "anons" },
			paused: { text: "Приостановлено", class: "paused" },
			discontinued: { text: "Прекращено", class: "discontinued" },
		};
		return statusMap[status] || { text: status || "Неизвестно", class: "other" };
	};

	/**
	 * Форматирует даты выхода аниме/манги
	 * @param {object} airedOn - Дата начала {year, month, day}
	 * @param {object} releasedOn - Дата окончания {year, month, day}
	 * @returns {object} - {dateRange: "в 2023-2024 гг.", tooltip: "С 29 сентября 2023 г. по 22 марта 2024 г."}
	 */
	const formatDates = (airedOn, releasedOn) => {
		const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня",
							"июля", "августа", "сентября", "октября", "ноября", "декабря"];

		if (!airedOn || !airedOn.year) {
			return { dateRange: "", tooltip: "" };
		}

		const startYear = airedOn.year;
		const endYear = releasedOn?.year;

		// Формируем диапазон годов
		let dateRange = "";
		if (endYear && endYear !== startYear) {
			dateRange = `в ${startYear}-${endYear} гг.`;
		} else if (endYear) {
			dateRange = `в ${startYear} г.`;
		} else {
			dateRange = `с ${startYear} г.`;
		}

		// Формируем подробную подсказку
		let tooltip = "";
		if (airedOn.day && airedOn.month) {
			const startDate = `${airedOn.day} ${monthNames[airedOn.month - 1]} ${startYear} г.`;
			if (releasedOn?.day && releasedOn?.month && endYear) {
				const endDate = `${releasedOn.day} ${monthNames[releasedOn.month - 1]} ${endYear} г.`;
				tooltip = `С ${startDate} по ${endDate}`;
			} else {
				tooltip = `С ${startDate}`;
			}
		} else {
			tooltip = dateRange;
		}

		return { dateRange, tooltip };
	};

	// Универсальная функция
	// Связано:
	// setupUserRateHandlers
	// STATUS_DATA
	// STATUS_CLASSES
	// Данные для статусов (тексты и классы)
	const STATUS_DATA = {
		anime: {
			planned: "Запланировано",
			watching: "Смотрю",
			rewatching: "Пересматриваю",
			completed: "Просмотрено",
			on_hold: "Отложено",
			dropped: "Брошено"
		},
		manga: {
			planned: "Запланировано",
			watching: "Читаю",
			rewatching: "Перечитываю",
			completed: "Прочитано",
			on_hold: "Отложено",
			dropped: "Брошено"
		},
		common: {
			add: "Добавить в список",
			remove: "Удалить из списка"
		}
	};

	// CSS классы для контейнера
	const STATUS_CLASSES = {
		planned: "planned",
		watching: "watching",
		rewatching: "rewatching",
		completed: "completed",
		on_hold: "on_hold",
		dropped: "dropped"
	};
	/**
	 * Генерирует HTML кнопку добавления в список.
	 * @param {number|string} targetId - ID аниме/манги.
	 * @param {string} targetType - "Anime" или "Manga" (с большой буквы, как требует API).
	 * @param {number|string} userId - ID пользователя.
	 * @param {Object|null} currentRate - Объект существующего статуса (или null, если нет).
	 *                                    Ожидается формат: { id, status, score, ... }
	 * @returns {string} HTML строка кнопки.
	 */
	const renderUserRateButton = (targetId, targetType, userId, currentRate = null) => {
		if (!userId || userId == null) return ""; // Если юзер не залогинен, кнопку не рисуем


		// Нормализация типа для словарей (anime/manga)
		// Ranobe использует те же статусы что и manga
		const typeKey = targetType.toLowerCase() === 'ranobe' ? 'manga' : targetType.toLowerCase();
		// Текстовки для этого типа
		const texts = STATUS_DATA[typeKey] || STATUS_DATA.anime;

		// Определяем текущее состояние
		const isExisting = !!(currentRate && currentRate.id);
		const status = isExisting ? currentRate.status : 'planned'; // дефолт для класса
		const rateId = isExisting ? currentRate.id : '';
		const score = isExisting ? currentRate.score : 0;

		// Определяем URL и Метод формы
		const formAction = isExisting ? `/api/v2/user_rates/${rateId}` : '/api/v2/user_rates';
		// В оригинале используется hidden input data-method, но мы будем обрабатывать это в JS

		// Текст текущего статуса
		const currentStatusText = isExisting ? texts[status] : STATUS_DATA.common.add;
		const containerClass = isExisting ? STATUS_CLASSES[status] : 'planned'; // planned по дефолту для цвета кнопки "Добавить"

		// Генерируем опции выпадающего списка
		const optionsHtml = Object.keys(STATUS_CLASSES).map(key => {
			// Пропускаем текущий статус в списке? Обычно Шики показывает все.
			return `
				<div class="option add-trigger" data-status="${key}">
					<div class="text"><span class="status-name" data-text="${texts[key]}"></span></div>
				</div>`;
		}).join('');

		// Кнопка удаления (только если запись существует)
		const removeHtml = isExisting ? `
			<div class="option remove-trigger" data-status="delete">
				<div class="text"><span class="status-name" data-text="${STATUS_DATA.common.remove}"></span></div>
			</div>` : '';

		// Генерация триггера (разная разметка для "Добавить" и "Редактировать")
		let triggerHtml = '';
		if (isExisting) {
			triggerHtml = `
				<div class="edit-trigger">
					<div class="edit"></div>
					<div class="text"><span class="status-name" data-text="${currentStatusText}"></span></div>
				</div>`;
		} else {
			triggerHtml = `
				<div class="text add-trigger" data-status="planned">
					<div class="plus"></div>
					<span class="status-name" data-text="${currentStatusText}"></span>
				</div>`;
		}

		// Сборка всего HTML
		// Нормализуем targetType для API: Ranobe -> Manga
		const apiTargetType = targetType === "Ranobe" ? "Manga" : targetType;
		return `
		<div class="b-user_rate ${typeKey}-${targetId}" data-target_id="${targetId}" data-target_type="${targetType}">
			<div class="b-add_to_list ${containerClass}">
				<form action="${formAction}" data-type="json">
					<input type="hidden" name="frontend" value="1">
					<input type="hidden" name="user_rate[user_id]" value="${userId}">
					<input type="hidden" name="user_rate[target_id]" value="${targetId}">
					<input type="hidden" name="user_rate[target_type]" value="${apiTargetType}">
					<input type="hidden" name="user_rate[status]" value="${status}">
					<input type="hidden" name="user_rate[score]" value="${score}">

					<div class="trigger">
						<div class="trigger-arrow"></div>
						${triggerHtml}
					</div>

					<div class="expanded-options">
						${optionsHtml}
						${removeHtml}
					</div>
				</form>
			</div>
		</div>`;
	};


	// --- LRU Кеш для API и тяжелых объектов ---
	class LRUCache {
		constructor(maxSize = 100) {
			this.cache = new Map();
			this.maxSize = maxSize;
		}

		get(key) {
			if (!this.cache.has(key)) return null;
			const val = this.cache.get(key);
			// Обновляем позицию элемента (делаем его "недавним")
			this.cache.delete(key);
			this.cache.set(key, val);
			return val;
		}

		set(key, value) {
			// Проверка на утечку памяти (работает в Chromium)
			if (window.performance && performance.memory) {
				const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
				if (usedJSHeapSize / jsHeapSizeLimit > 0.5) {
					debug('⚠️ Память превышает 50%. Сбрасываем половину кеша (LRU).');
					this.dropHalf();
				}
			}

			if (this.cache.has(key)) {
				this.cache.delete(key);
			} else if (this.cache.size >= this.maxSize) {
				// Удаляем самый старый элемент (первый добавленный)
				const oldestKey = this.cache.keys().next().value;
				this.cache.delete(oldestKey);
			}
			this.cache.set(key, value);
		}

		dropHalf() {
			const dropCount = Math.floor(this.cache.size / 2);
			let i = 0;
			for (const key of this.cache.keys()) {
				if (i >= dropCount) break;
				this.cache.delete(key);
				i++;
			}
		}
	}

	class PersistentLRUCache {
		constructor(namespace, maxSize = 20, ttlMs = 86400000) { // ttlMs = 24 часа по умолчанию
			this.prefix = `404fix_${namespace}_`;
			this.keysKey = `${this.prefix}keys`;
			this.maxSize = maxSize;
			this.ttlMs = ttlMs;

			try {
				this.keys = JSON.parse(localStorage.getItem(this.keysKey) || '[]');
			} catch {
				this.keys = [];
			}
		}

		get(key) {
			const itemStr = localStorage.getItem(this.prefix + key);
			if (!itemStr) return null;

			try {
				const item = JSON.parse(itemStr);
				// Проверяем срок годности
				if (Date.now() > item.exp) {
					this.delete(key);
					return null;
				}

				// Обновляем позицию (делаем недавно использованным)
				this.keys = this.keys.filter(k => k !== key);
				this.keys.push(key);
				this._saveKeys();

				return item.value;
			} catch { return null; }
		}

		set(key, value) {
			const exp = Date.now() + this.ttlMs;

			if (!this.keys.includes(key)) {
				this.keys.push(key);
			} else {
				this.keys = this.keys.filter(k => k !== key);
				this.keys.push(key);
			}

			// Выталкиваем самые старые элементы, если превысили лимит
			while (this.keys.length > this.maxSize) {
				const oldestKey = this.keys.shift();
				localStorage.removeItem(this.prefix + oldestKey);
			}

			this._saveKeys();
			try {
				localStorage.setItem(this.prefix + key, JSON.stringify({ value, exp }));
			} catch (e) {
				// Защита: если память переполнена - сбрасываем половину
				const dropCount = Math.ceil(this.keys.length / 2);
				for(let i = 0; i < dropCount; i++) {
					const k = this.keys.shift();
					localStorage.removeItem(this.prefix + k);
				}
				this._saveKeys();
				localStorage.setItem(this.prefix + key, JSON.stringify({ value, exp }));
			}
		}

		delete(key) {
			this.keys = this.keys.filter(k => k !== key);
			this._saveKeys();
			localStorage.removeItem(this.prefix + key);
		}

		_saveKeys() {
			localStorage.setItem(this.keysKey, JSON.stringify(this.keys));
		}
	}

    // === JIKAN API — ЗАМЕНА АРТОВ (постеры + скриншоты) ===
    const jikanImageCache = new PersistentLRUCache('jikan_images', 40, CONFIG.JIKAN_CACHE_TTL);

    const fetchJikanMedia = async (malId, isAnime = true) => {
        if (!malId) return { poster: null, screenshots: [] };

        const cacheKey = `mal_${malId}_${isAnime ? 'a' : 'm'}`;
        let cached = jikanImageCache.get(cacheKey);
        if (cached) {
            debug(`📦 Jikan media из кеша для MAL ${malId}`);
            return cached;
        }

        const type = isAnime ? 'anime' : 'manga';

        try {
            log(`🌐 Запрос к Jikan API: ${type}/${malId}`);

            // 1. Основная информация + большой постер
            const infoRes = await fetchWithTimeout(`${CONFIG.JIKAN_BASE}/${type}/${malId}`, {
                headers: { "User-Agent": CONFIG.USER_AGENT }
            });
            if (!infoRes.ok) throw new Error(`Jikan info: ${infoRes.status}`);
            const infoJson = await infoRes.json();

            const poster = infoJson.data?.images?.jpg?.large_image_url ||
                  infoJson.data?.images?.jpg?.image_url || null;

            // 2. Скриншоты / арты
            const picRes = await fetchWithTimeout(`${CONFIG.JIKAN_BASE}/${type}/${malId}/pictures`, {
                headers: { "User-Agent": CONFIG.USER_AGENT }
            });
            if (!picRes.ok) throw new Error(`Jikan pictures: ${picRes.status}`);
            const picsJson = await picRes.json();

            const screenshots = (picsJson.data || [])
            .slice(0, 20) // не больше 20 кадров
            .map((img, i) => ({
                id: `jikan_${malId}_${i}`,
                originalUrl: img.jpg?.image_url || img.webp?.image_url,
                x166Url: img.jpg?.image_url || img.webp?.image_url,
                x332Url: img.jpg?.image_url || img.webp?.image_url,
            }));

            const result = { poster, screenshots };

            jikanImageCache.set(cacheKey, result);
            log(`✅ Jikan API успешно: MAL ${malId} | постер: ${!!poster} | кадров: ${screenshots.length}`);

            return result;

        } catch (err) {
            error(`❌ Jikan API ошибка для MAL ${malId}:`, err.message);
            return { poster: null, screenshots: [] };
        }
    };

	// Создаем экземпляры кеша
	const similarCache = new PersistentLRUCache('similar', 20, 24 * 60 * 60 * 1000);

	// Кеш для тяжелых GraphQL данных (храним до 20 элементов 3 дня)
	const gqlCache = new PersistentLRUCache('gql', 20, 3 * 24 * 60 * 60 * 1000);

	// === ------------------------- ===
	// === Модуль обработки запросов ===
	// === ------------------------- ===

	// --- Rate Limiter (Ограничитель запросов) ---
	// const RATE_LIMIT_MS = 200; // 1000ms / 5 RPS = 200ms
	const requestQueue = [];
	let isProcessingQueue = false;

	const processQueue = async () => {
		if (requestQueue.length === 0) {
			isProcessingQueue = false;
			return;
		}
		isProcessingQueue = true;
		const nextRequest = requestQueue.shift();
		try {
			const result = await nextRequest.requestFn();
			nextRequest.resolve(result);
		} catch (e) {
			nextRequest.reject(e);
		}
		setTimeout(processQueue, CONFIG.RATE_LIMIT_MS);
	};

	/**
	 *
	 * @param {String} endpoint API запрос.
	 * @param {Boolean} isWebEndpoint Использовать ли endpoint сайта, который вызывают некоторые фронт-енд функции. Например, комментарии обращаются к внутреннему API сайта, а не API, который описывается в документации.
	 * @returns JSON ответ или ошибку.
	 */
	const apiRequest = (endpoint, isWebEndpoint = false) => {
		return new Promise((resolve, reject) => {
			const requestFn = async () => {
				const url = isWebEndpoint ? `${endpoint}` : `/api${endpoint}`;
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);

				try {
					const response = await fetch(url, {
						headers: { "User-Agent": CONFIG.USER_AGENT },
						signal: controller.signal,
					});
					clearTimeout(timeoutId);

					if (!response.ok)
						throw new Error(
							`API request failed: ${response.status} for ${url}`,
						);
					return await response.json();
				} catch (err) {
					clearTimeout(timeoutId);
					if (err.name === 'AbortError') {
						error(`Request timeout after ${CONFIG.FETCH_TIMEOUT}ms: ${url}`);
						throw new Error(`Request timeout: ${url}`);
					}
					error(err.message);
					throw err;
				}
			};
			requestQueue.push({ requestFn, resolve, reject });
			if (!isProcessingQueue) processQueue();
		});
	};

	// === ----------------------- ===
	// === Модуль получения данных ===
	// === ----------------------- ===

	/**
	 * Получение текущего пользователя через кешированное значение localStorage или whoami запрос.
	 * @returns Object описывающий залогиненного пользователя, null если пользователь не залогинен.
	 */
	const getCurrentUser = async () => {
		try {
			// 1. Пытаемся взять ID текущего пользователя из DOM
			let currentUserId = null;
			const dataUserAttr = document.body.getAttribute('data-user');
			if (dataUserAttr) {
				try {
					currentUserId = JSON.parse(dataUserAttr).id;
				} catch (e) { debug("Ошибка парсинга data-user из текущего DOM", e); }
			}

			// 2. Проверяем локальный кеш
			const cachedUserStr = localStorage.getItem('404fix_current_user');
			if (cachedUserStr) {
				const cachedUser = JSON.parse(cachedUserStr);
				// Если ID из data-user совпадает с кешем — возвращаем кеш (МИНУС 1 ЗАПРОС!)
				if (currentUserId && cachedUser.USER_ID === currentUserId) {
					log("👤 Пользователь загружен из кеша (ID совпал с data-user).");
					return cachedUser;
				}
			}

			// 3. Если кеша нет, или ID сменился (перезашли с другого аккаунта) — делаем whoami
			log("👤 Запрашиваем whoami (кеш пуст или аккаунт изменен)...");
			const user = await apiRequest("/users/whoami");
			if (!user || !user.id) {
				localStorage.removeItem('404fix_current_user');
				return null;
			}

			const userData = {
				USER_ID: user.id,
				USER_NICK: user.nickname,
				USER_URL: user.url || `${CONFIG.SITE_NAME}/${user.nickname}`,
				USER_AVATAR: user.avatar || user.image?.x48 || "",
				USER_AVATAR_X16: user.image?.x16 || "",
				USER_AVATAR_X32: user.image?.x32 || "",
				USER_AVATAR_X48: user.image?.x48 || "",
				USER_AVATAR_X64: user.image?.x64 || "",
				USER_AVATAR_X80: user.image?.x80 || "",
				USER_AVATAR_X148: user.image?.x148 || "",
				USER_AVATAR_X160: user.image?.x160 || "",
			};

			// Сохраняем в кеш для следующих страниц
			localStorage.setItem('404fix_current_user', JSON.stringify(userData));
			debug(`👤 Пользователь ${userData.USER_NICK} (${userData.USER_ID}) сохранён в локальное хранилище:`, userData);
			return userData;
		} catch (err) {
			error("Не удалось получить данные пользователя.", err.message);
			return null;
		}
	};

	/**
	 * Получает ID стиля пользователя, а затем сам CSS.
	 * @param {Number} userId ID текущего пользователя.
	 * @returns {Promise<string|null>} Скомпилированный CSS или null в случае ошибки/отсутствия.
	 */
	/**
	 * Fixes broken camo URLs in CSS by extracting and using the original URL directly.
	 * Camo URLs format: https://camo-v3.shikimori.io/{hash}?url={original_url}
	 * @param {String} css - CSS string potentially containing camo URLs
	 * @returns {String} - CSS with fixed URLs
	 */
	const fixCamoUrls = (css) => {
		if (!css) return css;

		try {
			// Match camo URLs in url() declarations
			const camoRegex = /url\(['"]?(https?:\/\/camo-v3\.shikimori\.[^\/]+\/[^?]+\?url=([^'")]+))['"]?\)/gi;

			let fixedCss = css.replace(camoRegex, (match, fullCamoUrl, encodedOriginalUrl) => {
				try {
					// Decode the original URL
					const originalUrl = decodeURIComponent(encodedOriginalUrl);
					debug(`🔧 Fixing camo URL: ${originalUrl}`);
					return `url('${originalUrl}')`;
				} catch (e) {
					// If decoding fails, return original match
					debug(`⚠️ Failed to decode camo URL: ${encodedOriginalUrl}`);
					return match;
				}
			});

			if (fixedCss !== css) {
				log(`🔧 Fixed ${(css.match(camoRegex) || []).length} camo URL(s) in CSS`);
			}

			return fixedCss;
		} catch (err) {
			error("❌ Error fixing camo URLs:", err.message);
			return css; // Return original CSS if processing fails
		}
	};

	const getUserStyle = async (userId) => {
		if (!userId) return null;

		try {
			log(
				`🎨 Запрашиваю данные пользователя ${userId} для получения ID стиля...`,
			);
			const userData = await apiRequest(`/users/${userId}`);
			const styleId = userData?.style_id;

			if (styleId) {
				log(`🎨 ID стиля найден: ${styleId}. Запрашиваю CSS...`);
				const styleData = await apiRequest(`/styles/${styleId}`);
				const compiledCss = styleData?.compiled_css;

				if (compiledCss) {
					log(`🎨 Пользовательский CSS успешно получен.`);
					return fixCamoUrls(compiledCss);
				} else {
					log(
						`🎨 Стиль ${styleId} не содержит скомпилированного CSS.`,
					);
					return null;
				}
			} else {
				log(
					`🎨 У пользователя ${userId} не установлен кастомный стиль.`,
				);
				return null;
			}
		} catch (err) {
			error(
				"❌ Ошибка при получении пользовательского стиля:",
				err.message,
			);
			return null; // Возвращаем null, чтобы не прерывать выполнение скрипта
		}
	};

	/**
	 * Загружает "донорскую" страницу для извлечения свежих ассетов: CSRF-токена, CSS и JS ссылок.
	 * @returns {Promise<assets|Error>} Возвращает заполненный object, пустую или неполную структуру, или же ошибку.
	 */
	const getPageAssets = async () => {
		const assets = {
			CSRF_TOKEN: null,
			FETCHED_CSS: "",
			FETCHED_JS: "",
			USER_DATA: null,
			CUSTOM_CSS: null
		};
		try {
			log("📦 Запрашиваю страницу-донор для получения ассетов, пользователя и CSS...");
			const response = await fetchWithTimeout(CONFIG.DONOR_URL);
			if (!response.ok) throw new Error(`Статус ответа: ${response.status}`);

			const pageHtml = await response.text();
			const parser = new DOMParser();
			const doc = parser.parseFromString(pageHtml, "text/html");

			// 1. CSRF-токен
			const tokenElement = doc.querySelector('meta[name="csrf-token"]');
			if (tokenElement) assets.CSRF_TOKEN = tokenElement.getAttribute("content");

			// 2. Скрипты и Стили
			const cssLinks = doc.querySelectorAll('head > link[rel="stylesheet"][href^="/packs/"], head > link[rel="stylesheet"][href^="/assets/"]');
			if (cssLinks) assets.FETCHED_CSS = Array.from(cssLinks).map((l) => l.outerHTML).join("\n");

			const jsScripts = doc.querySelectorAll('head > script[defer][src*="/packs/js/"]');
			if (jsScripts) assets.FETCHED_JS = Array.from(jsScripts).map((s) => s.outerHTML).join("\n");

			// 3. Данные пользователя из data-user
			const bodyUser = doc.body.getAttribute('data-user');
			if (bodyUser) {
				try {
					const rawUser = JSON.parse(bodyUser);
					if (rawUser.id) {
						// Пытаемся вытащить ник из URL ("https://shikimori.one/Nickname")
						const nick = rawUser.url ? rawUser.url.split('/').pop() : 'User';
						// Аватарку ищем в шапке
						const profileImg = doc.querySelector('.menu-dropdown.profile img');

						assets.USER_DATA = {
							USER_ID: rawUser.id,
							USER_NICK: nick,
							USER_URL: rawUser.url,
							USER_AVATAR_X48: profileImg ? profileImg.getAttribute('src') : '',
							USER_AVATAR_X80: (profileImg && profileImg.getAttribute('srcset')) ? profileImg.getAttribute('srcset').split(' ')[0] : ''
						};
						log(`👤 Извлечены данные пользователя: ${nick}`);
					}
				} catch (e) { debug("Ошибка парсинга data-user с донора", e); }
			}

			// 4. Custom CSS пользователя
			const customCssNode = doc.getElementById('custom_css');
			if (customCssNode) {
				assets.CUSTOM_CSS = fixCamoUrls(customCssNode.innerHTML);
				log("🎨 Кастомный CSS пользователя извлечен из донорской страницы.");
			}

			return assets;
		} catch (err) {
			error("❌ Ошибка при получении ассетов страницы:", err.message);
			return assets;
		}
	};

	// === --------------------------------- ===
	// === GraphQL + префетч (общая загрузка) ===
	// === --------------------------------- ===

	// Один GraphQL-запрос с повтором при временных сбоях (429/5xx/сеть/таймаут).
	const runGraphQL = (query, id) =>
		withRetry(
			async () => {
				const response = await fetchWithTimeout("/api/graphql", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"User-Agent": CONFIG.USER_AGENT,
						Accept: "application/json",
					},
					body: JSON.stringify({ query, variables: { id: String(id) } }),
				});
				if (!response.ok) {
					const e = new Error(`GQL HTTP ${response.status}`);
					e.status = response.status; // чтобы isRetryable распознал 429/5xx
					throw e;
				}
				const json = await response.json();
				// 200 OK, но GraphQL вернул ошибки и пустые данные — временный сбой.
				if (
					json &&
					json.errors &&
					(!json.data || Object.keys(json.data).length === 0)
				) {
					throw new Error(
						`GQL errors: ${JSON.stringify(json.errors).slice(0, 200)}`,
					);
				}
				return json;
			},
			{ label: "GraphQL", retries: 3 },
		);

	// Тяжёлые данные (Main + Details) с кешем и дедупликацией in-flight:
	// префетч и реальный рендер используют ОДИН и тот же запрос, а не два.
	const __gqlInFlight = new Map();
	const loadHeavyGQL = (id, type) => {
		const key = `${type}_${id}`;
		const cached = gqlCache.get(key);
		if (cached) return Promise.resolve(cached);
		if (__gqlInFlight.has(key)) return __gqlInFlight.get(key);

		const isAnime = type === "anime";
		const queryMain = isAnime
			? GRAPHQL_QUERY_ANIME_MAIN
			: GRAPHQL_QUERY_MANGA_MAIN;
		const queryDetails = isAnime
			? GRAPHQL_QUERY_ANIME_DETAILS
			: GRAPHQL_QUERY_MANGA_DETAILS;

		const p = Promise.all([
			runGraphQL(queryMain, id),
			runGraphQL(queryDetails, id),
		])
			.then(([main, details]) => {
				const result = { main, details };
				gqlCache.set(key, result);
				return result;
			})
			.finally(() => __gqlInFlight.delete(key));
		__gqlInFlight.set(key, p);
		return p;
	};

	// Ассеты донора одинаковы для всех тайтлов — кешируем на сессию.
	// При сбое (нет CSS/токена) кеш сбрасываем, чтобы дать повтор позже.
	let __assetsPromise = null;
	const getPageAssetsCached = () => {
		if (__assetsPromise) return __assetsPromise;
		__assetsPromise = getPageAssets()
			.then((assets) => {
				if (!assets || (!assets.FETCHED_CSS && !assets.CSRF_TOKEN)) {
					__assetsPromise = null; // не кешируем неудачную загрузку
				}
				return assets;
			})
			.catch((e) => {
				__assetsPromise = null;
				throw e;
			});
		return __assetsPromise;
	};

	// Разбор ссылки тайтла -> { id, type, displayType }.
	// type — для API (ranobe -> manga), displayType — для отображения.
	const parseEntityLink = (href) => {
		let pathname;
		try {
			pathname = new URL(href, location.origin).pathname;
		} catch (e) {
			return null;
		}
		const m = pathname.match(/^\/(animes|mangas|ranobe)\/([a-z0-9-]+)/i);
		if (!m) return null;
		const idMatch = m[2].match(/^(?:z)?(\d+)(?:-|$)/i);
		if (!idMatch) return null;
		const typePlural = m[1].toLowerCase();
		const type = typePlural === "ranobe" ? "manga" : typePlural.slice(0, -1);
		const displayType = typePlural === "ranobe" ? "ranobe" : type;
		return { id: idMatch[1], type, displayType };
	};

	// === ----------------------------------------- ===
	// === Список известных удалённых (18+) тайтлов  ===
	// === shikimori ID == MAL ID, поэтому ищем по ID ===
	// === ----------------------------------------- ===
	const DELETED_IDS_CACHE_KEY = "fix404_deleted_ids_v1";
	let __deletedSets = null; // { anime:Set, manga:Set } | null (пока не загружено)

	// Встроенный список (подставляется сборщиком tools/build.mjs).
	// null -> данные тянутся из сети (CONFIG.DELETED_IDS_URL). Не редактировать вручную.
	const EMBEDDED_DELETED_IDS = {"anime":[188,203,211,213,214,217,220,221,316,320,368,651,692,724,736,741,753,755,823,827,828,830,972,977,1038,1113,1263,1272,1273,1274,1275,1331,1332,1339,1353,1359,1360,1383,1385,1386,1387,1388,1389,1390,1401,1402,1403,1404,1405,1406,1407,1408,1499,1510,1511,1512,1513,1558,1595,1632,1633,1634,1635,1636,1639,1702,1763,1770,1779,1780,1781,1782,1783,1784,1785,1787,1788,1791,1821,1834,1895,1896,2007,2021,2070,2134,2135,2136,2137,2138,2139,2140,2145,2185,2186,2187,2188,2189,2190,2191,2194,2195,2208,2209,2240,2266,2275,2276,2315,2324,2325,2326,2327,2328,2329,2338,2339,2340,2341,2342,2343,2344,2345,2348,2349,2350,2351,2352,2353,2357,2360,2368,2370,2371,2372,2373,2374,2375,2376,2377,2378,2379,2380,2394,2395,2396,2410,2411,2412,2413,2430,2431,2432,2433,2434,2435,2436,2437,2438,2439,2440,2441,2442,2443,2444,2445,2446,2447,2469,2479,2480,2505,2506,2507,2530,2531,2532,2533,2539,2540,2541,2551,2588,2590,2610,2681,2721,2788,2794,2798,2821,2838,2841,2852,2858,2859,2861,2862,2863,2864,2866,2867,2868,2869,2870,2871,2872,2873,2874,2875,2883,2894,2896,2917,2935,2936,2943,2944,2945,2946,2955,2956,2957,2958,2959,2960,2977,2979,2982,2988,2989,2990,2991,3034,3039,3040,3046,3048,3050,3056,3058,3062,3063,3066,3074,3078,3082,3093,3094,3102,3105,3107,3108,3109,3140,3160,3171,3211,3239,3250,3254,3286,3300,3301,3302,3303,3307,3308,3309,3324,3329,3334,3350,3370,3377,3378,3379,3380,3382,3383,3384,3385,3393,3396,3402,3403,3411,3422,3427,3428,3439,3442,3452,3454,3478,3479,3526,3527,3529,3530,3531,3532,3534,3536,3537,3538,3539,3540,3541,3542,3543,3551,3553,3556,3557,3558,3559,3560,3562,3563,3564,3566,3567,3569,3578,3580,3581,3582,3583,3584,3586,3587,3622,3628,3633,3635,3636,3639,3643,3644,3645,3648,3649,3679,3680,3681,3705,3706,3707,3711,3728,3729,3747,3771,3793,3795,3802,3824,3826,3833,3883,3888,3890,3895,3896,3902,3908,3911,3912,3916,3917,3918,3919,3920,3921,3922,3939,3940,3941,3942,3944,3945,3950,3951,3953,3970,3976,3980,3981,3982,3983,3992,3995,3998,3999,4000,4004,4009,4010,4011,4017,4027,4034,4057,4084,4127,4157,4161,4164,4178,4260,4278,4304,4310,4340,4342,4350,4355,4356,4357,4358,4360,4363,4364,4365,4369,4378,4379,4399,4400,4463,4473,4479,4480,4487,4488,4489,4490,4491,4492,4493,4494,4495,4496,4497,4498,4502,4541,4555,4556,4557,4558,4560,4561,4562,4575,4590,4600,4601,4603,4604,4606,4607,4608,4638,4644,4645,4653,4675,4692,4697,4698,4699,4700,4701,4714,4717,4729,4730,4731,4732,4763,4774,4775,4799,4802,4803,4813,4816,4817,4818,4819,4820,4821,4824,4825,4832,4833,4834,4840,4841,4842,4848,4849,4852,4866,4867,4868,4946,5049,5054,5097,5107,5108,5109,5117,5154,5159,5160,5172,5173,5190,5191,5194,5208,5209,5210,5211,5212,5213,5214,5259,5281,5285,5315,5316,5321,5324,5347,5383,5391,5393,5398,5399,5400,5401,5402,5403,5408,5411,5423,5424,5427,5439,5455,5464,5522,5540,5541,5542,5543,5544,5545,5546,5547,5548,5550,5551,5552,5553,5555,5556,5557,5558,5559,5560,5561,5563,5565,5566,5567,5568,5569,5570,5571,5572,5573,5575,5576,5586,5587,5588,5589,5590,5603,5605,5606,5607,5608,5609,5610,5611,5612,5613,5614,5621,5643,5644,5645,5646,5649,5651,5653,5663,5664,5665,5674,5686,5687,5733,5743,5762,5773,5890,5924,5959,5993,6015,6025,6041,6097,6120,6122,6133,6194,6220,6235,6286,6328,6337,6402,6422,6465,6531,6558,6590,6622,6635,6685,6686,6689,6690,6691,6692,6694,6891,6892,6893,6903,6986,7053,7110,7154,7155,7178,7179,7262,7264,7265,7266,7268,7276,7343,7411,7455,7456,7458,7573,7581,7582,7583,7611,7612,7708,7712,7730,7748,7864,7908,7969,8039,8110,8111,8275,8289,8290,8291,8292,8293,8294,8471,8523,8574,8651,8652,8653,8654,8655,8837,8918,8987,9006,9008,9009,9091,9211,9257,9270,9287,9308,9309,9310,9311,9312,9316,9317,9322,9325,9326,9327,9328,9341,9352,9375,9434,9435,9442,9467,9486,9487,9503,9504,9507,9545,9588,9599,9638,9718,9721,9778,9849,9855,9887,9904,9939,9968,9970,10043,10101,10106,10256,10280,10286,10325,10327,10368,10380,10392,10409,10419,10420,10421,10424,10429,10457,10458,10488,10546,10552,10553,10570,10575,10590,10668,10683,10694,10695,10697,10728,10764,10770,10779,10792,10827,10851,10906,10938,11031,11065,11067,11141,11185,11321,11349,11465,11467,11469,11523,11745,11747,11749,11807,11815,11825,11827,11855,11879,11969,11997,12055,12057,12059,12061,12143,12373,12375,12397,12551,12563,12955,12957,12959,12961,12995,12997,13019,13051,13057,13217,13219,13221,13223,13325,13379,13559,13595,13643,13785,13917,13937,13959,14047,14127,14129,14207,14209,14379,14471,14539,14543,14657,14659,14661,14991,14993,14995,15097,15409,15537,15539,15541,15839,15841,15843,15845,15867,16059,16091,16187,16189,16472,16474,16476,16638,16642,16644,16914,17012,17251,17371,17491,17537,17539,17541,17543,17745,17747,17825,17833,17867,18151,18455,18479,18481,18483,18525,18653,18655,18691,18693,18695,18959,19051,19101,19103,19283,19523,19569,19629,19631,19633,19635,19747,19857,19859,20007,20377,20379,20589,20757,20801,20849,20959,20995,21001,21059,21069,21097,21349,21363,21393,21513,21521,21597,21751,21829,21925,22039,22069,22081,22119,22347,22429,22543,22655,22815,22901,23033,23047,23101,23171,23247,23305,23475,23477,23479,23519,23665,23677,23719,23761,24021,24271,24273,24317,24327,24357,24377,24453,24641,24743,24745,24849,24851,24911,24967,24987,25055,25345,25667,25669,25877,25923,26031,26059,27363,27413,27603,27747,27879,27881,27909,28157,28169,28309,28311,28313,28517,28519,28779,28859,28961,29083,29085,29111,29261,29307,29573,29575,29703,29705,29730,29807,29808,29809,29852,29915,29916,29992,29994,30128,30132,30242,30243,30269,30454,30460,30543,30583,30614,30658,30702,30741,30770,30812,30817,30891,30898,31101,31117,31118,31189,31331,31397,31400,31401,31403,31424,31518,31652,31740,31788,31789,31810,31885,31886,31995,32016,32063,32195,32238,32239,32267,32355,32405,32423,32484,32518,32587,32620,32667,32833,32864,32872,32895,32982,32997,33104,33125,33138,33153,33165,33231,33291,33322,33393,33505,33514,33515,33588,33750,33768,33769,33865,33962,33979,33981,33993,34015,34030,34107,34168,34246,34311,34312,34361,34388,34399,34491,34492,34506,34529,34530,34638,34639,34659,34740,34747,34758,34759,34795,34821,34823,34895,34899,34937,34959,34963,35028,35029,35178,35238,35343,35446,35498,35499,35512,35558,35573,35581,35592,35629,35726,35727,35780,35781,35827,35891,35926,35931,35936,36010,36033,36051,36052,36109,36121,36122,36137,36198,36225,36254,36256,36461,36689,36720,36721,36737,36755,36840,36849,36876,36889,36895,36933,36956,37088,37089,37127,37222,37223,37224,37233,37281,37287,37320,37340,37360,37405,37474,37659,37699,37771,37815,37939,38030,38031,38032,38033,38034,38035,38036,38037,38038,38039,38095,38107,38141,38212,38252,38260,38265,38330,38339,38453,38470,38513,38620,38621,38708,38732,38760,38775,38779,38798,38817,38831,38865,38866,38975,38994,38995,39042,39058,39068,39085,39299,39337,39365,39392,39466,39471,39526,39530,39640,39680,39794,39795,39800,39803,39842,39963,40022,40023,40048,40131,40212,40217,40254,40305,40336,40337,40398,40399,40471,40472,40519,40520,40521,40639,40658,40700,40746,40801,40819,40855,40922,40941,40959,41200,41207,41211,41212,41235,41236,41260,41261,41282,41332,41370,41375,41396,41397,41512,41691,41793,41794,41795,41824,41848,42031,42048,42141,42223,42224,42324,42383,42414,42517,42591,42592,42714,42756,42757,42848,43013,43015,43016,43426,43465,43466,43467,43791,43793,44044,44192,44193,44194,44211,46701,47591,48392,48422,48449,48450,48467,48468,48513,48568,48626,48651,48652,48654,48697,48698,48755,48843,48880,48889,49020,49028,49095,49222,49223,49295,49329,49335,49353,49460,49524,49580,49637,49734,49752,49760,49762,49876,49922,49943,49944,49945,49948,49987,49989,50051,50156,50161,50192,50208,50237,50251,50336,50434,50435,50436,50469,50487,50488,50622,50634,50654,50804,50958,51065,51088,51217,51294,51338,51463,51594,51662,51663,51664,51721,51722,51723,51736,51737,51763,51988,52104,52185,52197,52244,52245,52252,52402,52561,52617,52717,52733,52734,52752,52904,53070,53204,53229,53257,53258,53425,53492,53506,53677,53678,53702,53724,53725,53946,54015,54353,54622,54623,54629,54849,54912,55003,55145,55146,55158,55161,55162,55181,55309,55512,55524,55526,55547,55548,55616,55691,55849,55850,55902,56153,56154,56497,56511,56512,56654,56778,56779,56800,56852,56905,57044,57198,57283,57470,57501,57660,57661,57662,57789,57860,57861,57936,57937,58121,58122,58123,58185,58215,58242,58278,58563,58564,58616,58638,58641,58642,58732,58776,58873,58888,58890,58891,58892,58905,59118,59119,59120,59173,59185,59328,59403,59404,59407,59523,59697,59698,59706,59804,59840,60044,60147,60182,60216,60351,60390,60443,60470,60494,60495,60512,60553,60629,60642,60720,60784,60857,60980,60993,61164,61165,61166,61232,61353,61538,61539,61583,61599,61620,61627,61628,61742,61788,61789,61790,61909,61910,61911,61935,61936,61937,62106,62145,62314,62315,62316,62328,62339,62353,62369,62379,62380,62406,62537,62577,62578,62686,62689,62897,62921,63026,63027,63074,63084,63096,63158,63159,63232,63248,63345,63394,63520,63582,63657,63765,63810,63846,64053,64070,64095,64128,64146,64250,64291,64292,64297,64301,64373,64404,64405],"manga":[605,632,839,1277,1281,1391,1392,1393,1394,1395,1767,2927,2929,2958,3095,3212,3233,3234,3300,3410,3411,3412,3421,3422,3424,3437,3440,3442,3445,3447,3449,3450,3454,3460,3461,3462,3501,3512,3527,3528,3530,3535,3536,3542,3558,3562,3622,3623,3624,3625,3629,3697,3701,3702,3703,3705,3706,3707,3733,3736,3739,3742,3744,3768,3794,3801,3804,3805,3806,3808,3810,3812,3815,3823,3827,3828,3830,3832,3833,3834,3835,3844,3847,3848,3870,3922,3937,3940,3967,3969,3977,3979,3984,3985,4023,4029,4106,4162,4164,4165,4169,4170,4217,4225,4240,4315,4740,4741,5180,5192,5419,5435,5436,5437,5439,5467,5736,6278,6628,6824,6833,6840,6899,6947,6972,7073,7124,7127,7128,7129,7146,7164,7257,7298,7303,7412,7413,7452,7470,7484,7489,7501,7545,7579,7580,7608,7609,7612,7616,7683,7686,7688,7746,7785,7801,7803,7804,7805,7807,7808,7817,7820,7823,7825,7826,7827,7830,7831,7833,7862,7874,7875,7884,7897,7906,7907,7908,7998,8258,8326,8349,8426,8458,8498,8526,8808,8844,8858,8859,8937,9013,9020,9081,9316,9420,9709,9759,9760,9847,9865,9912,9913,9914,9916,9917,9919,9920,9921,9922,9923,9924,9925,9926,9927,9938,9939,9940,9941,9942,9943,9944,9945,9946,9947,9948,9949,9950,9951,9952,9953,9954,9955,9956,9957,9958,9959,9960,9961,9968,10020,10087,10157,10158,10217,10245,10248,10269,10379,10428,10574,10753,10769,10775,11017,11025,11108,11115,11123,11158,11200,11256,11271,11309,11312,11333,11369,11427,11510,11534,11549,11556,11580,11637,11642,11650,11740,11760,11762,11765,11811,11821,11826,11829,11885,11888,11916,11936,11986,11999,12034,12088,12089,12129,12130,12171,12176,12177,12178,12218,12223,12230,12301,12316,12339,12348,12393,12402,12403,12408,12409,12410,12546,12563,12564,12565,12600,12634,12661,12710,12715,12723,12730,12804,12827,12847,12932,12935,12940,12977,12984,13109,13231,13246,13286,13304,13317,13332,13333,13353,13376,13388,13425,13464,13467,13531,13547,13569,13570,13620,13650,13684,13805,13987,14037,14081,14085,14100,14106,14107,14108,14152,14193,14242,14267,14362,14371,14372,14373,14374,14375,14393,14394,14416,14417,14449,14450,14476,14551,14552,14584,14585,14602,14638,14644,14646,14648,14651,14667,14693,14694,14742,14755,14756,14765,14766,14767,14769,14793,14794,14797,14802,14803,14805,14812,14813,14815,14817,14819,14838,14840,14848,14853,14867,14878,14912,14913,14915,14916,14917,14958,14959,14960,14962,14963,14966,14968,15004,15019,15024,15026,15028,15031,15034,15063,15076,15080,15131,15196,15199,15232,15294,15296,15308,15310,15353,15354,15374,15402,15419,15430,15462,15524,15560,15568,15580,15598,15733,15747,15773,15789,15791,15819,15853,15864,15909,15925,15926,15939,15941,15944,15948,15979,15989,16000,16001,16002,16012,16014,16017,16021,16022,16024,16035,16041,16047,16079,16101,16105,16116,16117,16128,16130,16131,16133,16134,16139,16152,16154,16155,16167,16170,16201,16206,16214,16266,16267,16275,16299,16322,16324,16326,16336,16337,16340,16363,16364,16365,16366,16367,16368,16379,16387,16388,16435,16463,16464,16469,16475,16477,16487,16488,16489,16491,16492,16493,16495,16510,16545,16546,16559,16560,16561,16568,16573,16590,16591,16863,16886,16887,16910,16917,16918,16991,17047,17058,17078,17083,17109,17120,17130,17138,17254,17266,17269,17270,17289,17290,17316,17332,17338,17346,17352,17369,17379,17382,17438,17466,17469,17470,17564,17603,17605,17645,17678,17727,17787,17804,17812,17813,17816,17843,17850,17922,17944,17951,17990,17993,18033,18081,18099,18102,18122,18134,18156,18168,18174,18199,18207,18301,18303,18332,18349,18378,18426,18463,18476,18529,18561,18628,18662,18730,18796,18797,18798,18805,18851,18852,18886,18921,18948,18951,19040,19092,19106,19126,19133,19165,19184,19201,19202,19220,19260,19261,19305,19361,19403,19411,19425,19485,19644,19689,19690,19724,19725,19756,19758,19760,19783,19811,19854,19858,19913,19976,19977,20007,20015,20033,20034,20047,20052,20059,20061,20070,20093,20117,20119,20128,20177,20179,20180,20223,20252,20255,20299,20302,20311,20312,20313,20319,20320,20335,20353,20387,20389,20399,20403,20478,20479,20487,20488,20492,20498,20499,20500,20502,20517,20527,20536,20559,20560,20570,20571,20573,20610,20611,20653,20692,20709,20715,20897,20905,20913,20915,20917,20927,20932,20941,20951,20972,21010,21012,21037,21050,21102,21106,21122,21126,21154,21169,21193,21195,21196,21197,21199,21206,21208,21209,21211,21213,21231,21232,21234,21236,21238,21240,21241,21242,21244,21245,21246,21247,21248,21249,21250,21269,21280,21284,21293,21373,21374,21493,21546,21573,21605,21606,21636,21661,21668,21688,21714,21719,21721,21724,21727,21728,21746,21748,21751,21764,21765,21768,21769,21771,21772,21773,21774,21775,21776,21777,21778,21779,21780,21786,21792,21793,21794,21807,21808,21810,21811,21812,21816,21817,21818,21819,21820,21821,21834,21839,21849,21855,21869,21871,21873,21874,21875,21876,21877,21878,21887,21914,21918,21936,21940,21941,21944,21954,21955,21958,21960,21961,21962,21964,21966,21986,22006,22011,22012,22015,22016,22017,22018,22019,22020,22021,22022,22024,22025,22041,22042,22043,22064,22072,22076,22077,22081,22084,22089,22126,22141,22145,22146,22152,22153,22155,22205,22213,22219,22220,22224,22227,22228,22236,22237,22238,22269,22270,22272,22274,22277,22283,22285,22286,22312,22317,22318,22321,22330,22332,22340,22345,22346,22357,22362,22372,22373,22374,22375,22376,22377,22380,22387,22388,22399,22407,22409,22410,22411,22432,22458,22462,22463,22465,22468,22469,22470,22472,22486,22502,22512,22524,22526,22579,22590,22591,22592,22593,22596,22599,22606,22609,22612,22613,22624,22625,22662,22666,22667,22668,22680,22681,22683,22704,22724,22726,22736,22739,22740,22741,22758,22759,22760,22827,22828,22832,22838,22840,22844,22845,22869,22930,22931,22932,22960,22976,22977,22979,23043,23048,23061,23064,23101,23106,23120,23122,23124,23126,23128,23129,23132,23133,23137,23143,23144,23145,23146,23152,23155,23163,23164,23190,23221,23389,23409,23410,23411,23412,23421,23434,23451,23454,23456,23461,23471,23483,23510,23520,23544,23545,23579,23594,23625,23634,23635,23686,23708,23714,23715,23719,23752,23759,23812,23813,23831,23833,23853,23855,23872,23914,23916,23919,23966,23974,23990,23994,24000,24048,24055,24135,24136,24137,24140,24158,24163,24168,24169,24170,24171,24180,24188,24189,24194,24195,24196,24197,24198,24200,24202,24203,24206,24245,24259,24260,24304,24331,24333,24359,24384,24388,24391,24392,24397,24410,24415,24416,24448,24491,24508,24511,24623,24634,24642,24678,24687,24711,24712,24713,24719,24740,24752,24758,24762,24781,24782,24784,24788,24789,24814,24843,24844,24853,24854,24860,24911,24912,24913,24918,24919,24920,24921,24922,24924,24931,24932,24935,24957,24958,24975,24976,24993,24998,25000,25001,25002,25004,25005,25006,25007,25009,25032,25033,25039,25040,25047,25048,25050,25051,25056,25073,25074,25087,25095,25099,25100,25102,25103,25104,25126,25138,25139,25140,25142,25143,25145,25147,25156,25192,25275,25303,25305,25367,25369,25381,25390,25399,25400,25402,25406,25426,25429,25431,25432,25434,25436,25441,25443,25445,25511,25512,25517,25523,25565,25610,25619,25622,25623,25626,25651,25662,25667,25686,25691,25705,25731,25737,25740,25745,25746,25754,25756,25760,25761,25774,25785,25790,25802,25830,25832,25865,25887,25920,25934,25935,25936,25957,26003,26004,26025,26032,26035,26042,26043,26045,26054,26062,26066,26067,26068,26069,26070,26093,26097,26112,26120,26222,26223,26226,26227,26228,26242,26261,26269,26309,26316,26332,26349,26397,26400,26413,26420,26435,26437,26438,26461,26470,26471,26472,26483,26498,26516,26517,26518,26526,26563,26607,26630,26649,26668,26722,26730,26738,26799,26873,26879,26883,26885,26891,26895,26897,26911,26917,26921,26925,26939,26991,26993,27069,27097,27099,27103,27107,27121,27123,27125,27147,27201,27205,27209,27213,27215,27219,27221,27253,27255,27257,27263,27267,27269,27339,27341,27403,27465,27467,27525,27527,27539,27541,27551,27565,27567,27569,27591,27601,27603,27605,27609,27611,27645,27647,27649,27651,27653,27703,27713,27753,27755,27787,27797,27799,27825,27897,27911,27923,27973,27975,27977,27995,27999,28001,28003,28055,28057,28083,28085,28087,28089,28095,28137,28166,28170,28186,28190,28196,28204,28228,28249,28283,28341,28425,28427,28431,28441,28475,28479,28481,28483,28505,28541,28583,28585,28637,28641,28643,28673,28711,28747,28767,28781,28847,28849,28869,28871,28873,28889,28891,28909,28939,28941,28943,28945,28963,28977,28981,28985,28999,29015,29019,29023,29033,29035,29037,29043,29065,29077,29081,29085,29093,29107,29137,29151,29153,29157,29161,29167,29169,29171,29185,29201,29203,29223,29275,29281,29359,29393,29401,29419,29425,29449,29481,29483,29487,29491,29493,29497,29499,29501,29503,29507,29527,29533,29535,29537,29551,29555,29559,29573,29575,29577,29579,29581,29627,29629,29689,29693,29695,29717,29719,29737,29745,29797,29825,29865,29869,29923,29943,29947,29965,29981,30001,30003,30005,30035,30039,30057,30061,30073,30075,30077,30081,30093,30095,30097,30103,30111,30113,30117,30127,30151,30155,30195,30211,30231,30233,30235,30245,30249,30253,30261,30263,30269,30275,30279,30281,30283,30287,30291,30293,30295,30297,30319,30323,30325,30331,30333,30335,30337,30339,30345,30351,30355,30395,30399,30445,30455,30513,30515,30583,30645,30647,30651,30657,30659,30661,30663,30667,30669,30671,30673,30675,30677,30681,30683,30685,30687,30689,30691,30693,30697,30699,30701,30703,30705,30707,30709,30713,30719,30721,30729,30731,30763,30765,30767,30769,30771,30773,30775,30785,30819,30835,30841,30843,30847,30879,30885,30923,30999,31021,31023,31039,31047,31109,31113,31139,31145,31147,31183,31239,31253,31259,31261,31263,31267,31269,31279,31281,31317,31321,31345,31347,31467,31663,31665,31667,31669,31671,31675,31677,31679,31683,31687,31689,31693,31697,31701,31703,31705,31709,31713,31715,31717,31721,31723,31725,31727,31729,31733,31735,31737,31739,31743,31745,31747,31749,31751,31755,31757,31763,31765,31767,31771,31777,31781,31785,31789,31793,31795,31799,31805,31807,31809,31813,31815,31817,31829,31831,31833,31957,31961,31969,31989,31991,32083,32101,32121,32369,32387,32537,32543,32545,32547,32551,32555,32565,32569,32573,32575,32577,32579,32581,32583,32589,32591,32593,32595,32597,32601,32603,32605,32609,32613,32615,32619,32625,32631,32633,32637,32639,32643,32645,32647,32649,32651,32655,32661,32663,32665,32669,32671,32681,32683,32687,32689,32691,32697,32699,32701,32703,32705,32737,32741,32747,32749,32769,32789,32869,33007,33059,33137,33147,33203,33241,33255,33289,33443,33459,33491,33573,33761,33779,33819,34079,34089,34217,34337,34595,34621,34629,34631,34693,34719,34757,34797,34799,35041,35091,35201,35353,35449,35619,35663,35699,35705,35809,35831,35869,36225,36241,36295,36393,36433,36491,36533,36555,36715,36765,36813,36915,36995,37031,37097,37101,37103,37567,37577,37583,37595,37617,37651,37763,37771,37777,37807,37863,37867,37947,38009,38137,38141,38143,38145,38187,38189,38191,38193,38195,38197,38199,38201,38213,38215,38217,38221,38223,38225,38227,38233,38237,38239,38241,38247,38249,38253,38255,38257,38259,38263,38265,38271,38275,38279,38281,38293,38299,38309,38313,38315,38317,38321,38323,38325,38331,38333,38335,38341,38343,38345,38353,38355,38357,38359,38361,38365,38367,38369,38377,38379,38381,38383,38385,38387,38389,38393,38395,38397,38399,38401,38403,38405,38407,38409,38411,38413,38415,38417,38419,38421,38423,38427,38429,38431,38433,38435,38437,38449,38451,38453,38457,38461,38465,38467,38469,38487,38489,38491,38495,38497,38499,38501,38509,38511,38513,38515,38517,38519,38521,38523,38525,38527,38531,38533,38535,38539,38541,38543,38545,38549,38551,38553,38555,38557,38563,38565,38569,38573,38575,38577,38579,38581,38585,38591,38593,38595,38599,38601,38605,38607,38609,38611,38613,38615,38617,38619,38621,38623,38625,38631,38633,38637,38655,38657,38659,38661,38665,38667,38671,38675,38677,38679,38681,38683,38687,38689,38691,38695,38699,38709,38727,38729,38731,38733,38737,38739,38741,38743,38745,38747,38751,38753,38755,38757,38759,38769,38777,38779,38781,38783,38785,38789,38793,38795,38801,38803,38807,38813,38817,38821,38823,38825,38829,38833,38837,38839,38841,38843,38851,38853,38857,38859,38861,38863,38865,38867,38869,38871,38873,38877,38881,38883,38887,38895,38897,38903,38905,38907,38911,38915,38917,38919,38923,38925,38927,38929,38931,38933,38935,38939,38943,38949,38951,38953,38955,38957,38959,38961,38973,38977,38981,38983,38985,38987,38989,38991,38993,38995,38999,39001,39003,39005,39015,39017,39019,39021,39027,39029,39031,39033,39037,39039,39043,39063,39079,39099,39109,39111,39113,39115,39117,39119,39133,39137,39153,39177,39179,39181,39189,39257,39259,39261,39263,39265,39269,39417,39443,39467,39471,39473,39475,39477,39479,39483,39489,39493,39495,39499,39571,39721,39725,39727,39761,39885,39887,39889,39891,39897,39899,39901,39903,39905,39909,39911,39915,39917,39923,39925,39929,39931,39933,39943,39989,40079,40449,40557,40615,40619,40621,40623,40625,40627,40631,40633,40635,40637,40639,40641,40645,40647,40649,40651,40653,40661,40663,40667,40671,40673,40675,40683,40685,40689,40693,40697,40833,41607,41613,41793,42017,42243,42349,42527,42663,42709,42839,42851,42947,42949,42951,42953,42959,42961,42963,42965,42967,42971,42977,42981,42983,42985,42987,42989,42993,42997,43003,43005,43007,43009,43015,43017,43019,43025,43029,43033,43035,43041,43043,43047,43049,43051,43053,43055,43057,43059,43061,43065,43067,43069,43073,43075,43077,43085,43087,43089,43091,43093,43095,43101,43103,43105,43109,43111,43113,43115,43117,43123,43125,43127,43129,43131,43133,43135,43137,43139,43141,43147,43149,43151,43153,43155,43159,43163,43167,43169,43171,43173,43175,43177,43179,43181,43183,43185,43187,43189,43191,43199,43201,43203,43205,43207,43209,43211,43213,43219,43225,43241,43245,43247,43249,43251,43253,43257,43259,43261,43263,43273,43279,43283,43291,43293,43295,44047,44051,44053,44141,44455,44459,44567,44581,44583,44873,44931,45059,45063,45069,45101,45225,45227,45329,45367,45371,45391,45401,45403,45413,45437,45465,45481,45483,45489,45515,45541,45543,45545,45549,45583,45587,45595,45599,45725,45727,45731,45747,45835,45879,45960,46044,46332,46370,46462,46468,46470,46534,46584,47008,47090,47096,47120,47162,47292,47316,47330,47407,47529,47601,47733,47787,48037,48189,48203,48301,48327,48427,48851,49033,49039,49041,49063,49149,49175,49235,49237,49261,49271,49377,49379,49387,49389,49401,49433,49453,49491,49531,49533,49545,49555,49667,49697,49703,49755,49801,49899,49903,49923,50103,50213,50253,50355,50389,50479,50481,50525,50667,50803,50919,51137,51139,51141,51143,51203,51229,51403,51413,51427,51473,51477,51481,51543,51745,51883,51885,51889,51891,51893,51913,51919,51931,52045,52119,52149,52309,52317,52329,52507,52509,52511,52513,52515,52517,52519,52521,52523,52525,52533,52535,52537,52539,52541,52543,52545,52547,52549,52551,52555,52557,52559,52565,52567,52569,52571,52573,52575,52577,52579,52581,52583,52589,52591,52593,52595,52599,52601,52603,52605,52607,52609,52611,52615,52617,52619,52621,52623,52625,52627,52629,52631,52633,52635,52641,52647,52649,52653,52657,52659,52661,52663,52667,52669,52671,52689,52693,52695,52709,52713,52723,52725,52727,52729,52731,52737,52743,52747,52753,52755,52757,52759,52761,52763,52769,52771,52773,52775,52777,52783,52787,52789,52791,52793,52795,52797,52821,52825,52827,52829,52833,52835,52837,52839,52841,52843,52847,52851,52857,52861,52863,52873,52875,52877,52879,52883,52885,52887,52889,52893,52895,52899,52905,52907,52909,52911,52919,52923,52925,52927,52929,52931,52935,52937,52939,52941,52943,52947,52949,52957,52959,52961,52963,52965,52967,52969,52971,52973,52975,52977,52979,52981,52983,52985,52995,52997,52999,53001,53003,53005,53007,53009,53013,53019,53021,53023,53029,53031,53033,53035,53037,53039,53041,53043,53045,53047,53049,53051,53055,53057,53065,53069,53071,53073,53077,53079,53085,53087,53089,53105,53109,53111,53115,53117,53121,53129,53139,53141,53143,53145,53147,53149,53151,53153,53155,53157,53165,53167,53173,53175,53181,53185,53187,53191,53193,53197,53203,53207,53209,53211,53213,53215,53219,53221,53223,53225,53229,53231,53233,53235,53237,53239,53241,53243,53245,53249,53253,53259,53261,53265,53269,53271,53275,53277,53291,53293,53295,53297,53299,53301,53303,53305,53315,53317,53319,53321,53323,53325,53329,53331,53335,53339,53341,53343,53345,53347,53349,53351,53353,53355,53357,53359,53369,53371,53373,53381,53383,53385,53387,53393,53395,53397,53399,53405,53407,53413,53415,53417,53419,53421,53423,53425,53427,53429,53431,53433,53435,53437,53439,53441,53443,53445,53447,53449,53451,53453,53455,53457,53459,53461,53463,53467,53469,53471,53473,53475,53479,53481,53483,53485,53487,53489,53491,53493,53495,53497,53499,53501,53503,53505,53507,53511,53513,53515,53519,53525,53527,53559,53561,53563,53565,53571,53573,53577,53583,53585,53587,53589,53591,53593,53595,53597,53599,53601,53603,53605,53607,53611,53613,53615,53617,53619,53621,53623,53625,53635,53637,53641,53643,53645,53647,53649,53653,53661,53663,53667,53669,53671,53673,53675,53677,53679,53681,53685,53687,53689,53691,53693,53695,53697,53699,53703,53705,53707,53715,53717,53719,53721,53723,53731,53737,53739,53741,53743,53745,53747,53749,53751,53753,53755,53763,53769,53773,53775,53781,53783,53785,53787,53793,53795,53797,53799,53801,53803,53805,53807,53811,53813,53817,53819,53821,53823,53827,53829,53833,53835,53837,53839,53843,53847,53851,53853,53855,53857,53859,53861,53867,53871,53881,53883,53885,53887,53893,53897,53903,53905,53907,53913,53923,53925,53933,53935,53937,53939,53943,53945,53947,53951,53955,53957,53959,53961,53967,53969,53971,53973,53975,53977,53979,53981,53985,53987,53991,53993,53995,53999,54001,54005,54007,54009,54013,54015,54029,54031,54035,54037,54039,54041,54043,54047,54049,54051,54053,54055,54057,54059,54063,54069,54073,54075,54077,54079,54083,54085,54089,54093,54095,54101,54107,54109,54115,54231,54317,54479,54483,54485,54491,54493,54495,54497,54499,54501,54503,54505,54507,54509,54511,54513,54515,54517,54519,54523,54527,54529,54537,54539,54541,54545,54547,54549,54601,54603,54605,54607,54613,54615,54617,55053,55189,55345,55349,55565,55589,55601,55603,55607,55611,55613,55615,55617,55619,55623,55625,55627,55629,55637,55639,55641,55645,55651,55653,55655,55657,55659,55663,55667,55669,55671,55673,55675,55677,55679,55683,55685,55693,55695,55697,55705,55711,55715,55717,55721,55723,55729,55737,55739,55743,55745,55747,55749,55753,55755,55757,55793,55853,55905,55947,55949,55951,55953,55955,55957,55959,55961,55963,55971,55973,55975,55979,55983,56019,56021,56025,56027,56031,56033,56035,56037,56039,56229,56253,56257,56259,56261,56263,56265,56267,56269,56273,56275,56277,56279,56283,56285,56287,56289,56291,56293,56297,56299,56305,56335,56337,56369,56371,56561,56593,56595,56599,56603,56605,56607,56715,56817,56831,57141,57271,57277,57483,57511,57525,57527,57529,57533,57547,57549,57555,57561,57565,57571,57575,57577,57591,57595,57601,57605,57609,57611,57617,57619,57621,57629,57633,57635,57637,57639,57641,57643,57645,57647,57649,57655,57661,57663,57667,57671,57673,57675,57679,57681,57683,57685,57689,57691,57693,57699,57701,57705,57727,57731,57733,57735,57737,57745,57747,57749,57755,57757,57761,57869,58031,58093,58153,58263,58265,58267,58269,58271,58273,58275,58277,58279,58419,58535,58607,58609,58771,58781,58783,58785,58787,58789,58791,58793,58795,58797,58799,58803,58807,58809,58811,58813,58815,58817,58819,58821,58823,58825,58827,58829,58831,58833,58835,58839,58843,58845,58847,58849,58851,58861,58863,58867,58869,58873,58877,58885,58887,58891,58895,58897,58899,58903,58907,58913,58915,58917,58919,58923,58925,58927,58929,58931,58933,58935,58939,58945,58949,58951,58953,58955,58957,58959,58963,58965,58967,58969,58973,58975,58977,58981,58983,58987,58989,58991,58993,58995,58997,58999,59001,59003,59005,59007,59009,59011,59013,59041,59063,59079,59413,59415,59417,59419,59421,59425,59427,59429,59431,59433,59437,59441,59443,59445,59449,59453,59455,59457,59459,59461,59463,59465,59467,59473,59475,59485,59487,59491,59493,59495,59497,59499,59621,59623,59635,59639,59703,59715,59793,59811,59813,59815,59817,59819,59821,59823,59825,59827,59831,59833,59837,59839,59843,59845,59903,59921,59923,59925,59933,59935,59937,59939,59941,59943,59945,59949,59953,59959,60019,60031,60037,60039,60043,60047,60063,60125,60135,60137,60139,60143,60147,60149,60151,60153,60155,60157,60159,60227,60235,60237,60239,60241,60243,60245,60249,60253,60257,60261,60291,60309,60311,60313,60315,60317,60319,60321,60323,60325,60327,60329,60331,60333,60335,60337,60339,60343,60429,60431,60433,60439,60443,60447,60451,60455,60459,60463,60521,60523,60525,60527,60529,60531,60533,60535,60537,60539,60541,60543,60545,60547,60549,60551,60555,60601,60629,60631,60639,60641,60643,60645,60647,60649,60653,60659,60663,60733,60735,60737,60739,60741,60745,60747,60749,60751,60753,60755,60757,60759,60761,60763,60765,60767,60769,60835,60837,60839,60841,60843,60845,60847,60849,60851,60853,60857,60861,60865,60867,60871,60935,60937,60939,60941,60943,60945,60947,60949,60951,60953,60955,60957,60959,60961,60963,60965,60995,61001,61011,61015,61029,61031,61035,61037,61039,61041,61043,61049,61083,61105,61115,61125,61127,61131,61135,61141,61161,61167,61197,61203,61219,61249,61253,61257,61275,61277,61279,61281,61283,61303,61305,61331,61333,61351,61353,61355,61359,61375,61377,61393,61395,61417,61419,61423,61437,61439,61455,61457,61459,61479,61487,61491,61505,61509,61511,61519,61525,61527,61545,61547,61555,61559,61565,61567,61569,61575,61591,61593,61595,61617,61619,61631,61633,61645,61647,61657,61663,61669,61671,61675,61681,61687,61699,61701,61709,61719,61721,61739,61741,61763,61765,61779,61781,61787,61789,61797,61807,61837,61839,61843,61845,61857,61859,61865,61867,61891,61921,61923,61935,61937,61947,61949,61953,61955,61961,61989,62003,62005,62015,62029,62031,62041,62045,62047,62055,62057,62063,62065,62075,62079,62087,62089,62091,62093,62097,62099,62101,62107,62109,62111,62113,62115,62117,62119,62123,62125,62127,62129,62131,62137,62145,62147,62149,62151,62153,62155,62157,62159,62161,62163,62165,62167,62173,62177,62179,62181,62193,62195,62197,62199,62203,62205,62207,62209,62211,62213,62215,62221,62223,62225,62227,62229,62245,62247,62249,62253,62255,62267,62269,62277,62285,62287,62289,62301,62303,62311,62313,62315,62317,62319,62323,62333,62339,62343,62345,62349,62351,62353,62355,62357,62359,62361,62363,62365,62367,62369,62371,62373,62379,62383,62389,62391,62395,62397,62403,62407,62413,62415,62421,62423,62425,62433,62435,62439,62441,62443,62445,62447,62449,62451,62453,62461,62463,62465,62489,62491,62513,62515,62521,62523,62529,62553,62555,62563,62565,62575,62577,62579,62581,62583,62585,62587,62589,62591,62593,62595,62601,62603,62607,62611,62619,62623,62637,62647,62649,62651,62653,62655,62657,62659,62667,62679,62683,62697,62703,62707,62711,62719,62725,62733,62743,62747,62757,62779,62787,62791,62811,62835,62837,62843,62865,62883,62895,62907,62909,62911,62913,62915,62919,62921,62933,62937,62939,62971,62987,62997,62999,63007,63009,63011,63013,63025,63031,63045,63053,63055,63057,63059,63061,63063,63065,63067,63069,63071,63073,63075,63077,63079,63081,63083,63087,63089,63093,63095,63097,63099,63109,63121,63125,63133,63141,63143,63145,63147,63149,63151,63165,63173,63181,63193,63203,63205,63207,63211,63213,63215,63217,63219,63221,63223,63225,63227,63229,63245,63269,63273,63285,63287,63289,63291,63293,63297,63307,63309,63315,63317,63319,63331,63341,63343,63347,63349,63351,63355,63361,63363,63369,63371,63375,63377,63379,63381,63387,63389,63391,63393,63395,63397,63399,63401,63403,63407,63409,63411,63413,63417,63419,63421,63425,63427,63431,63435,63451,63465,63473,63483,63489,63493,63513,63517,63529,63539,63541,63549,63561,63565,63583,63599,63607,63621,63623,63633,63641,63647,63649,63651,63657,63665,63689,63701,63709,63733,63741,63751,63759,63761,63767,63797,63805,63809,63811,63813,63815,63817,63819,63821,63823,63825,63833,63855,63865,63875,63879,63881,63915,63917,63945,63951,63959,63963,63965,63967,63969,63971,63973,63975,63977,63979,63981,63985,63987,63993,63997,63999,64001,64015,64021,64027,64031,64033,64053,64067,64069,64091,64095,64099,64105,64117,64127,64151,64161,64171,64175,64201,64213,64219,64233,64237,64281,64283,64285,64287,64289,64291,64293,64295,64303,64305,64307,64319,64323,64329,64343,64357,64361,64363,64365,64367,64369,64371,64373,64375,64377,64379,64381,64395,64399,64405,64415,64429,64441,64443,64449,64451,64453,64457,64469,64485,64497,64503,64505,64513,64515,64529,64541,64555,64559,64571,64575,64579,64581,64583,64595,64611,64631,64647,64659,64661,64663,64665,64669,64689,64691,64703,64709,64721,64745,64761,64769,64783,64803,64813,64819,64831,64845,64893,64905,64911,64933,64947,64951,64959,64977,65009,65017,65023,65035,65047,65061,65081,65093,65103,65111,65117,65139,65157,65165,65171,65183,65215,65233,65247,65259,65265,65287,65289,65305,65313,65323,65341,65343,65345,65347,65349,65351,65353,65355,65357,65359,65361,65363,65365,65369,65371,65373,65375,65377,65379,65381,65383,65389,65391,65393,65401,65403,65405,65407,65409,65411,65413,65415,65417,65419,65421,65423,65425,65429,65433,65435,65441,65445,65449,65451,65453,65455,65457,65461,65467,65483,65503,65513,65515,65523,65533,65547,65553,65559,65565,65581,65585,65589,65599,65605,65625,65635,65675,65681,65691,65699,65701,65715,65731,65735,65741,65763,65765,65767,65769,65781,65785,65793,65801,65809,65815,65843,65853,65861,65873,65877,65891,65893,65897,65913,65925,65955,65971,65981,65983,66015,66021,66037,66041,66043,66045,66053,66063,66069,66071,66073,66075,66077,66081,66083,66117,66123,66131,66137,66205,66215,66221,66227,66229,66231,66233,66237,66239,66249,66259,66269,66273,66285,66303,66305,66313,66319,66359,66371,66393,66395,66405,66435,66439,66453,66463,66469,66487,66493,66499,66505,66511,66519,66527,66531,66541,66551,66555,66583,66587,66597,66599,66601,66607,66611,66615,66649,66657,66661,66663,66667,66677,66679,66713,66715,66725,66729,66731,66735,66747,66749,66771,66773,66799,66815,66823,66829,66853,66859,66863,66865,66873,66875,66877,66881,66885,66891,66901,66919,66927,66929,66931,66933,66935,66937,66939,66945,66957,66975,66979,66985,66987,66989,66991,66999,67001,67005,67009,67047,67065,67075,67077,67087,67095,67097,67103,67107,67127,67133,67135,67141,67143,67155,67157,67159,67161,67173,67181,67183,67185,67197,67203,67205,67207,67209,67217,67231,67233,67241,67243,67249,67251,67263,67265,67269,67271,67273,67279,67287,67289,67293,67295,67299,67303,67309,67333,67363,67365,67369,67381,67383,67413,67415,67425,67427,67429,67431,67469,67471,67473,67475,67477,67493,67501,67503,67505,67507,67509,67515,67553,67555,67557,67559,67561,67563,67565,67593,67595,67627,67629,67631,67633,67635,67637,67639,67641,67643,67653,67655,67659,67661,67663,67665,67671,67677,67679,67681,67685,67691,67711,67713,67721,67725,67727,67737,67741,67743,67749,67751,67753,67775,67785,67787,67789,67791,67793,67795,67805,67807,67853,67855,67857,67859,67861,67863,67865,67867,67869,67871,67873,67885,67887,67889,67897,67899,67913,67915,67917,67919,67921,67923,67931,67939,67947,67949,67981,67983,67987,67991,68007,68009,68043,68049,68057,68059,68063,68065,68067,68075,68077,68081,68085,68087,68109,68117,68123,68125,68129,68131,68149,68151,68161,68163,68165,68173,68175,68201,68203,68211,68241,68249,68251,68277,68307,68309,68311,68313,68315,68317,68319,68321,68323,68325,68327,68329,68341,68343,68375,68407,68409,68411,68413,68415,68417,68433,68465,68467,68473,68475,68483,68485,68487,68489,68491,68493,68495,68497,68499,68505,68517,68523,68527,68547,68575,68579,68583,68589,68605,68607,68613,68617,68621,68637,68641,68649,68695,68697,68703,68705,68711,68715,68719,68729,68731,68747,68761,68767,68771,68773,68789,68795,68797,68817,68833,68835,68845,68859,68861,68865,68867,68873,68875,68889,68891,68893,68917,68923,68925,68945,68949,68951,68953,68959,68963,68999,69001,69005,69009,69019,69049,69053,69055,69061,69063,69065,69091,69095,69103,69105,69111,69123,69127,69157,69163,69165,69201,69207,69209,69219,69225,69229,69265,69267,69269,69273,69277,69281,69285,69303,69305,69307,69309,69313,69325,69341,69343,69345,69361,69363,69367,69393,69403,69409,69419,69439,69447,69457,69467,69483,69485,69495,69499,69507,69511,69513,69527,69531,69539,69551,69557,69559,69569,69575,69577,69579,69583,69585,69587,69591,69593,69611,69615,69621,69627,69631,69633,69637,69641,69643,69645,69647,69657,69661,69663,69665,69667,69669,69675,69677,69679,69681,69683,69685,69687,69689,69691,69693,69697,69699,69701,69703,69705,69707,69709,69711,69715,69717,69719,69721,69725,69733,69739,69743,69757,69759,69767,69775,69779,69787,69789,69799,69801,69807,69809,69835,69839,69843,69847,69863,69867,69873,69875,69877,69891,69899,69909,69915,69919,69923,69925,69927,69939,69943,69955,69971,69977,69981,69989,70005,70007,70009,70015,70017,70021,70023,70027,70031,70039,70047,70049,70051,70073,70079,70083,70091,70095,70127,70133,70139,70141,70143,70149,70151,70153,70159,70167,70201,70203,70213,70221,70225,70227,70229,70231,70233,70235,70237,70239,70263,70265,70267,70275,70277,70285,70287,70291,70293,70297,70319,70337,70343,70353,70371,70413,70421,70431,70439,70441,70443,70467,70479,70491,70501,70503,70505,70507,70509,70517,70533,70535,70551,70563,70569,70575,70577,70579,70585,70607,70615,70623,70635,70659,70683,70685,70689,70697,70707,70709,70721,70737,70743,70745,70747,70749,70777,70779,70781,70803,70825,70831,70835,70837,70839,70841,70843,70845,70847,70849,70851,70853,70855,70857,70859,70861,70863,70865,70867,70869,70871,70873,70877,70901,70903,70907,70913,70915,70917,70925,70929,70931,70943,70959,70961,70963,70977,70991,71005,71007,71009,71021,71023,71027,71047,71053,71059,71063,71075,71079,71099,71101,71115,71117,71135,71139,71143,71171,71173,71175,71181,71217,71233,71237,71243,71245,71247,71249,71251,71255,71257,71261,71263,71279,71285,71305,71315,71327,71361,71385,71389,71391,71393,71395,71397,71399,71401,71403,71405,71407,71409,71411,71413,71415,71417,71419,71421,71423,71425,71427,71437,71449,71451,71453,71467,71479,71481,71493,71507,71519,71533,71543,71551,71555,71561,71563,71569,71571,71573,71581,71585,71599,71601,71619,71637,71745,71749,71765,71769,71805,71809,71843,71845,71867,71869,71873,71875,71879,71883,71893,71897,71901,71921,71923,71925,71927,71943,71947,71951,71953,71955,71959,71975,71977,71979,72063,72065,72159,72161,72169,72171,72173,72175,72177,72179,72181,72183,72311,72313,72325,72327,72329,72331,72333,72335,72377,72379,72381,72383,72385,72389,72391,72395,72397,72399,72401,72403,72407,72409,72411,72413,72415,72417,72419,72425,72473,72475,72477,72479,72481,72483,72485,72487,72489,72491,72493,72529,72531,72571,72629,72655,72657,72659,72661,72663,72665,72667,72669,72671,72673,72675,72677,72679,72681,72683,72685,72691,72693,72695,72697,72703,72705,72709,72739,72741,72743,72745,72747,72749,72751,72753,72755,72757,72759,72761,72857,72859,72903,72905,72907,72915,72917,72919,72921,72923,72925,72927,72929,72931,72933,72935,73061,73063,73065,73067,73069,73071,73073,73075,73077,73079,73081,73231,73233,73235,73237,73241,73243,73245,73247,73249,73251,73253,73255,73257,73263,73317,73319,73321,73323,73325,73327,73329,73331,73333,73335,73337,73407,73409,73413,73415,73469,73471,73473,73475,73477,73479,73481,73483,73485,73487,73489,73539,73649,73651,73653,73655,73657,73659,73661,73663,73665,73667,73669,73797,73799,73801,73803,73805,73807,73809,73811,73813,73815,73817,73955,73957,73959,73961,73965,73967,73969,73971,73973,74095,74097,74099,74101,74103,74105,74107,74109,74111,74113,74115,74187,74189,74191,74193,74201,74203,74205,74207,74209,74211,74213,74215,74217,74219,74223,74225,74227,74229,74233,74235,74239,74241,74243,74245,74247,74249,74253,74255,74275,74291,74305,74307,74315,74317,74319,74327,74329,74353,74355,74367,74369,74381,74383,74387,74417,74427,74429,74443,74445,74455,74515,74517,74521,74523,74527,74533,74539,74541,74547,74559,74561,74571,74583,74585,74589,74591,74599,74601,74627,74629,74635,74637,74641,74643,74659,74661,74663,74665,74667,74669,74673,74675,74677,74679,74683,74685,74689,74691,74715,74717,74725,74727,74757,74771,74773,74775,74777,74779,74805,74807,74815,74817,74827,74829,74831,74835,74837,74839,74911,74913,74941,74943,74949,74951,74961,74967,74975,74977,74983,74985,74999,75001,75059,75063,75071,75073,75085,75089,75091,75093,75095,75107,75109,75131,75133,75151,75153,75155,75163,75165,75213,75215,75223,75225,75231,75233,75245,75247,75249,75251,75253,75257,75259,75261,75263,75267,75269,75279,75303,75305,75315,75317,75321,75323,75325,75327,75337,75339,75367,75369,75375,75377,75399,75401,75403,75405,75407,75409,75411,75419,75421,75453,75455,75465,75467,75481,75483,75501,75503,75521,75525,75535,75537,75545,75547,75593,75595,75617,75631,75633,75635,75651,75653,75661,75663,75673,75675,75691,75693,75705,75707,75725,75735,75737,75743,75745,75759,75761,75779,75781,75785,75787,75801,75803,75811,75813,75815,75831,75833,75835,75841,75847,75849,75851,75855,75857,75865,75867,75885,75887,75919,75921,75951,75953,75963,75965,75977,76027,76051,76053,76071,76073,76077,76089,76091,76151,76153,76161,76163,76237,76239,76289,76291,76309,76311,76347,76349,76355,76357,76363,76365,76387,76389,76391,76393,76399,76401,76417,76419,76425,76427,76439,76441,76443,76445,76447,76449,76453,76457,76463,76467,76469,76471,76475,76477,76479,76483,76487,76489,76491,76493,76495,76497,76499,76501,76503,76511,76513,76531,76533,76541,76543,76555,76557,76579,76581,76599,76601,76605,76607,76623,76625,76629,76631,76645,76647,76649,76651,76653,76655,76657,76669,76671,76685,76687,76695,76697,76723,76725,76737,76739,76743,76745,76749,76751,76755,76757,76777,76779,76781,76783,76789,76795,76827,76837,76841,76849,76853,76861,76863,76895,76897,76901,76903,76905,76907,76909,76911,76915,76917,76919,76921,76925,76935,76937,76945,76947,76949,76951,76961,76963,76983,76985,76991,76995,77005,77007,77015,77017,77021,77035,77037,77055,77063,77071,77085,77087,77097,77101,77103,77107,77115,77117,77125,77127,77131,77133,77159,77161,77169,77171,77181,77183,77185,77187,77189,77191,77193,77195,77197,77199,77201,77203,77205,77207,77295,77299,77309,77311,77313,77319,77323,77327,77329,77331,77333,77335,77337,77339,77347,77349,77351,77353,77355,77381,77385,77387,77389,77391,77393,77395,77397,77399,77401,77403,77405,77411,77415,77437,77443,77445,77449,77451,77499,77507,77509,77553,77591,77677,77703,77705,77707,77709,77713,77715,77717,77719,77721,77723,77729,77731,77733,77735,77737,77739,77741,77743,77745,77747,77749,77751,77757,77759,77761,77763,77909,77911,77913,77915,77917,77919,77921,77923,77927,77929,77945,78019,78077,78079,78081,78083,78085,78087,78089,78091,78093,78095,78141,78157,78159,78185,78189,78193,78263,78267,78287,78317,78325,78327,78331,78385,78387,78389,78397,78399,78407,78411,78413,78415,78417,78419,78421,78423,78425,78427,78431,78437,78439,78441,78449,78451,78463,78483,78487,78489,78491,78493,78495,78549,78553,78555,78559,78561,78563,78565,78567,78569,78571,78593,78595,78597,78603,78605,78657,78661,78663,78665,78667,78705,78707,78709,78711,78713,78715,78787,78801,78817,78819,78825,78827,78829,78833,78835,78837,78879,78939,78941,78945,78947,78949,78953,78989,78991,78993,78995,78997,79075,79155,79247,79249,79251,79253,79255,79257,79265,79271,79273,79275,79277,79279,79281,79283,79285,79287,79289,79291,79293,79295,79297,79299,79301,79303,79307,79309,79313,79315,79317,79319,79321,79323,79325,79331,79335,79337,79341,79343,79345,79347,79349,79351,79353,79363,79365,79367,79369,79371,79445,79447,79449,79461,79463,79465,79469,79487,79491,79599,79695,79697,79699,79701,79703,79729,79735,79737,79739,79741,79743,79747,79751,79753,79761,79841,79845,79853,79855,79857,79859,79861,79863,79865,79889,79953,79955,79957,79959,80009,80011,80013,80015,80081,80083,80085,80087,80231,80271,80275,80277,80303,80305,80307,80311,80313,80317,80319,80321,80323,80325,80327,80337,80339,80341,80343,80345,80347,80349,80351,80403,80407,80461,80463,80465,80467,80505,80507,80509,80511,80593,80595,80599,80601,80605,80613,80617,80619,80621,80623,80629,80631,80633,80635,80637,80639,80641,80647,80653,80659,80661,80663,80665,80695,80697,80701,80739,80745,80749,80751,80773,80817,80917,81021,81031,81033,81035,81037,81039,81041,81053,81055,81057,81059,81061,81063,81107,81137,81139,81141,81143,81159,81267,81269,81271,81309,81311,81313,81335,81337,81339,81365,81461,81521,81523,81525,81527,81567,81629,81631,81757,81759,81761,81763,81765,81793,81795,81807,81811,81817,81823,81827,81829,81831,81835,81839,81841,81843,81849,81851,81855,81859,81861,81863,81865,81867,81869,81871,81873,81875,81879,81881,81883,81889,81891,81899,81901,81903,81907,81937,82019,82027,82033,82097,82189,82217,82219,82221,82223,82319,82321,82327,82377,82385,82387,82389,82391,82393,82395,82415,82417,82419,82421,82423,82425,82455,82457,82459,82461,82463,82519,82521,82523,82525,82527,82529,82531,82549,82551,82553,82555,82557,82559,82561,82563,82565,82569,82599,82601,82603,82605,82607,82609,82633,82635,82637,82639,82641,82643,82651,82665,82667,82669,82675,82677,82679,82681,82685,82703,82705,82707,82709,82723,82725,82727,82763,82765,82767,82813,82823,82825,82827,82829,82831,82875,82877,82889,82899,82903,82929,82931,82933,82935,82937,82979,82981,83007,83009,83011,83013,83017,83073,83075,83077,83109,83111,83113,83157,83159,83161,83163,83165,83195,83199,83201,83215,83233,83235,83303,83305,83307,83309,83311,83313,83315,83317,83319,83355,83357,83359,83361,83463,83549,83555,83589,83591,83593,83595,83597,83599,83601,83697,83701,83703,83705,83707,83709,83711,83713,83715,83797,83929,83931,83939,83941,83943,83951,83953,83955,83963,83965,83969,83973,83975,83977,83979,83981,83983,83985,83987,83989,83995,83997,83999,84011,84013,84017,84019,84023,84025,84027,84029,84031,84033,84035,84037,84041,84043,84045,84047,84049,84051,84053,84055,84057,84063,84065,84071,84083,84085,84087,84089,84091,84093,84097,84101,84107,84109,84111,84113,84115,84117,84121,84127,84129,84131,84135,84141,84143,84145,84147,84149,84155,84159,84163,84169,84171,84181,84187,84189,84191,84193,84197,84199,84201,84203,84207,84209,84211,84215,84217,84219,84221,84237,84241,84243,84245,84247,84249,84251,84253,84267,84269,84271,84273,84275,84277,84285,84287,84289,84291,84293,84295,84297,84299,84303,84305,84307,84353,84357,84359,84361,84363,84365,84367,84369,84371,84375,84377,84379,84381,84385,84387,84401,84403,84405,84453,84455,84457,84509,84511,84575,84579,84581,84583,84585,84587,84589,84591,84593,84611,84695,84721,84781,84843,84903,84905,84907,84957,84959,84963,84965,85021,85023,85025,85053,85093,85097,85099,85103,85107,85109,85111,85115,85129,85137,85139,85157,85167,85273,85275,85285,85287,85291,85293,85331,85333,85335,85337,85433,85441,85445,85447,85543,85557,85559,85625,85627,85635,85747,85751,85753,85755,85787,85803,85805,85806,85807,85808,85809,85826,85841,85843,85844,85845,85846,85847,85871,85895,85945,85946,85947,85948,85949,85950,85952,85953,85954,85955,85957,85958,85960,86064,86065,86066,86067,86068,86069,86070,86071,86072,86077,86078,86097,86130,86131,86132,86133,86134,86189,86221,86222,86309,86345,86398,86407,86424,86425,86427,86428,86429,86430,86431,86432,86433,86435,86436,86438,86439,86440,86441,86442,86446,86448,86449,86451,86453,86454,86455,86456,86458,86460,86461,86462,86463,86464,86466,86467,86468,86469,86470,86472,86473,86474,86475,86476,86477,86478,86479,86480,86482,86483,86486,86487,86489,86490,86492,86493,86495,86496,86497,86498,86499,86501,86502,86505,86506,86507,86508,86509,86511,86512,86513,86514,86515,86516,86517,86518,86519,86520,86521,86522,86523,86524,86525,86526,86527,86528,86529,86530,86532,86533,86534,86535,86537,86538,86539,86540,86541,86542,86544,86545,86546,86548,86550,86552,86554,86556,86557,86558,86559,86575,86577,86618,86619,86620,86621,86623,86624,86625,86626,86627,86634,86660,86662,86663,86685,86686,86687,86739,86740,86741,86743,86745,86747,86816,86818,86819,86820,86821,86822,86823,86824,86825,86826,86827,86828,86829,86832,86833,86834,86836,86837,86842,86865,86866,86903,86904,86905,86906,86907,86908,86909,86911,86912,86916,86917,86918,86938,86956,86988,86989,86997,87040,87075,87089,87090,87091,87092,87094,87103,87108,87214,87311,87312,87313,87314,87315,87319,87320,87323,87324,87328,87329,87330,87331,87332,87335,87336,87337,87338,87339,87341,87347,87348,87349,87352,87353,87372,87373,87400,87401,87402,87426,87427,87428,87429,87537,87538,87539,87572,87573,87574,87576,87594,87595,87596,87619,87643,87667,87668,87709,87710,87711,87732,87733,87734,87735,87838,87840,87841,87842,87843,87847,87848,87850,87851,87853,87854,87855,87856,87857,87860,87861,87863,87865,87867,87869,87870,87871,87872,87873,87874,87875,87876,87877,87878,87879,87880,87883,87884,87885,87886,87887,87889,87892,87894,87927,87928,87963,87976,88020,88021,88022,88043,88068,88155,88163,88165,88169,88170,88172,88174,88175,88176,88178,88179,88180,88181,88182,88183,88184,88185,88186,88187,88188,88189,88190,88191,88192,88193,88194,88196,88197,88199,88200,88201,88202,88203,88205,88206,88207,88208,88210,88211,88212,88215,88216,88217,88218,88219,88220,88221,88222,88223,88224,88225,88226,88227,88260,88265,88267,88272,88276,88279,88292,88307,88308,88316,88324,88325,88371,88372,88373,88374,88375,88376,88401,88402,88403,88418,88422,88423,88434,88496,88497,88498,88499,88512,88531,88606,88607,88608,88609,88610,88653,88654,88655,88683,88684,88685,88725,88726,88727,88797,88798,88799,88800,88804,88805,88807,88808,88809,88810,88811,88812,88813,88814,88815,88816,88817,88820,88822,88823,88824,88825,88826,88827,88829,88830,88831,88832,88833,88834,88835,88836,88837,88838,88839,88840,88841,88842,88843,88844,88845,88846,88847,88852,88853,88854,88876,88877,88911,88918,88919,88920,88921,88952,88953,89058,89060,89105,89106,89107,89108,89109,89111,89112,89115,89119,89120,89121,89122,89123,89124,89125,89126,89127,89156,89186,89187,89212,89214,89215,89223,89224,89225,89226,89227,89286,89288,89289,89297,89300,89301,89304,89306,89307,89308,89309,89310,89311,89312,89314,89316,89326,89327,89328,89335,89342,89421,89438,89451,89458,89477,89478,89479,89480,89504,89508,89509,89510,89511,89512,89515,89516,89517,89518,89519,89521,89522,89524,89525,89526,89530,89534,89537,89548,89549,89550,89555,89556,89561,89564,89566,89567,89572,89573,89574,89575,89611,89612,89613,89614,89616,89617,89618,89622,89623,89624,89625,89626,89627,89629,89630,89631,89632,89633,89636,89637,89639,89640,89641,89646,89647,89649,89655,89656,89657,89659,89660,89662,89664,89665,89666,89667,89668,89682,89690,89692,89695,89697,89699,89725,89727,89728,89778,89800,89801,89802,89803,89804,89828,89835,89836,89837,89863,89874,89875,89876,89877,89878,89879,89880,89889,89890,89891,89932,89933,90033,90040,90041,90075,90082,90305,90345,90346,90430,90433,90440,90458,90459,90460,90461,90464,90471,90484,90485,90488,90489,90490,90492,90521,90522,90551,90588,90589,90590,90612,90682,90707,90708,90709,90731,90809,90812,90813,90829,90830,90921,90946,90951,90982,91001,91039,91043,91044,91046,91056,91097,91164,91192,91193,91195,91213,91214,91215,91216,91217,91218,91219,91220,91221,91222,91223,91224,91227,91228,91229,91231,91232,91234,91235,91236,91237,91242,91243,91247,91254,91255,91257,91258,91260,91261,91262,91263,91265,91266,91267,91272,91273,91276,91277,91279,91281,91282,91283,91284,91285,91292,91293,91295,91297,91298,91299,91301,91302,91303,91305,91307,91308,91309,91311,91312,91313,91314,91317,91318,91319,91320,91321,91322,91323,91324,91326,91327,91328,91330,91332,91333,91334,91335,91337,91338,91340,91341,91342,91343,91344,91345,91346,91348,91349,91350,91352,91353,91354,91355,91356,91357,91358,91359,91360,91361,91362,91363,91364,91365,91366,91367,91368,91370,91372,91373,91374,91375,91376,91377,91378,91379,91380,91381,91382,91383,91384,91385,91389,91390,91392,91393,91395,91396,91397,91398,91399,91400,91401,91402,91404,91405,91408,91409,91410,91411,91412,91413,91414,91416,91419,91420,91421,91423,91424,91425,91426,91427,91453,91462,91464,91467,91474,91475,91488,91489,91490,91491,91493,91494,91495,91496,91500,91507,91520,91527,91528,91529,91530,91533,91557,91560,91564,91592,91593,91594,91596,91602,91603,91604,91605,91606,91607,91608,91621,91626,91627,91628,91630,91631,91632,91633,91635,91636,91637,91646,91650,91658,91659,91660,91661,91664,91682,91684,91686,91687,91689,91690,91691,91692,91693,91698,91700,91715,91716,91717,91741,91742,91773,91774,91813,91814,91837,91839,91840,91855,91858,91859,91860,91865,91883,91912,91921,91960,91988,91990,91991,91992,91994,91995,91998,91999,92000,92001,92002,92003,92004,92005,92007,92034,92036,92057,92059,92060,92061,92066,92077,92080,92081,92082,92096,92100,92132,92150,92151,92154,92161,92174,92176,92177,92197,92198,92199,92200,92201,92204,92205,92207,92218,92220,92228,92284,92315,92488,92502,92510,92511,92514,92515,92578,92633,92641,92691,92698,92711,92714,92715,92719,92722,92768,92864,92865,92866,92916,92918,92919,92941,92986,92987,93066,93067,93068,93111,93154,93155,93167,93188,93206,93246,93248,93249,93250,93319,93320,93321,93330,93337,93338,93339,93341,93343,93344,93345,93369,93370,93371,93373,93382,93383,93410,93429,93505,93607,93635,93646,93652,93654,93655,93661,93663,93665,93749,93750,93760,93768,93771,93778,93779,93780,93795,93855,93865,93866,93867,93868,93870,93955,93970,93983,93985,93990,94001,94003,94042,94046,94053,94054,94056,94057,94087,94098,94102,94103,94106,94125,94135,94136,94138,94161,94195,94216,94217,94218,94219,94241,94242,94243,94244,94245,94258,94263,94304,94381,94387,94388,94408,94459,94551,94574,94627,94628,94629,94634,94639,94656,94686,94687,94709,94712,94713,94776,94777,94804,94805,94807,94809,94810,94820,94821,94841,94842,94843,94852,94895,94897,94899,94900,94901,94902,94903,94926,94937,94974,94991,94992,94993,95013,95014,95017,95025,95027,95028,95030,95034,95050,95052,95056,95113,95115,95126,95128,95150,95151,95152,95153,95154,95155,95156,95157,95158,95159,95161,95162,95163,95164,95190,95191,95192,95194,95231,95232,95276,95299,95300,95301,95305,95324,95325,95351,95365,95366,95425,95429,95438,95457,95488,95515,95599,95644,95645,95646,95647,95648,95650,95662,95663,95664,95665,95675,95680,95681,95688,95690,95691,95692,95729,95731,95733,95741,95743,95759,95760,95768,95769,95770,95783,95788,95789,95790,95791,95792,95829,95852,95854,95867,95868,95869,95870,95879,95886,95929,95930,95943,95944,95988,95990,95992,95993,95994,96005,96006,96008,96009,96027,96052,96053,96056,96065,96066,96081,96082,96083,96129,96152,96156,96164,96168,96181,96182,96201,96222,96223,96224,96225,96231,96232,96242,96253,96269,96270,96271,96272,96290,96294,96298,96314,96341,96349,96378,96379,96380,96397,96433,96442,96443,96444,96445,96446,96447,96450,96451,96471,96472,96478,96523,96527,96552,96555,96556,96579,96594,96611,96614,96620,96625,96638,96658,96662,96663,96664,96665,96667,96669,96698,96699,96700,96701,96702,96704,96705,96706,96713,96796,96797,96798,96814,96815,96816,96817,96834,96848,96849,96851,96867,96869,96903,96904,96909,96917,96921,96933,96943,96946,96963,96964,96965,96966,96967,96982,96983,96993,96994,96997,96998,96999,97000,97016,97018,97065,97066,97067,97081,97104,97118,97120,97121,97122,97126,97138,97139,97140,97141,97142,97143,97151,97153,97154,97164,97168,97169,97188,97189,97190,97191,97192,97193,97194,97195,97198,97199,97207,97209,97224,97236,97237,97238,97239,97240,97241,97242,97263,97265,97272,97276,97277,97279,97284,97287,97288,97289,97298,97306,97308,97310,97315,97318,97322,97326,97331,97332,97345,97368,97378,97387,97399,97400,97401,97407,97409,97410,97412,97418,97419,97420,97423,97424,97425,97433,97436,97439,97443,97453,97456,97457,97458,97459,97482,97512,97517,97525,97527,97544,97545,97546,97547,97549,97550,97551,97552,97553,97555,97556,97559,97560,97570,97582,97583,97584,97586,97587,97589,97594,97595,97596,97599,97606,97610,97611,97614,97617,97639,97640,97641,97642,97652,97655,97657,97661,97662,97666,97667,97669,97679,97680,97702,97703,97704,97707,97710,97725,97740,97741,97742,97743,97745,97747,97751,97753,97755,97759,97774,97776,97778,97782,97783,97793,97797,97801,97802,97803,97807,97828,97829,97830,97831,97832,97833,97834,97835,97836,97845,97856,97859,97864,97865,97867,97868,97884,97886,97891,97896,97897,97898,97904,97905,97907,97913,97928,97953,97954,97955,97958,97959,97960,97975,97976,97978,97981,97983,97984,97999,98002,98003,98006,98007,98008,98023,98025,98030,98033,98069,98076,98077,98098,98110,98111,98116,98121,98122,98125,98127,98128,98129,98136,98137,98138,98139,98154,98155,98159,98161,98162,98178,98180,98181,98183,98209,98210,98211,98212,98213,98219,98221,98227,98228,98229,98230,98243,98244,98259,98260,98261,98263,98281,98283,98298,98299,98308,98320,98321,98364,98391,98394,98406,98421,98431,98435,98440,98441,98447,98458,98470,98472,98473,98474,98482,98483,98487,98512,98523,98537,98547,98581,98589,98623,98635,98689,98705,98706,98710,98761,98787,98793,98795,98801,98802,98839,98857,98866,98867,98868,98869,98870,98871,98872,98873,98874,98875,98906,98907,98917,98936,98945,98950,98951,98955,98956,98957,98958,98959,98962,98985,98992,99023,99024,99025,99026,99030,99068,99069,99070,99091,99128,99138,99165,99172,99186,99187,99203,99215,99222,99223,99225,99226,99227,99228,99229,99230,99231,99236,99271,99272,99300,99301,99302,99324,99325,99326,99327,99330,99337,99338,99339,99368,99370,99371,99382,99405,99413,99432,99454,99482,99483,99484,99490,99491,99493,99494,99495,99496,99497,99499,99500,99501,99502,99503,99504,99505,99506,99507,99508,99509,99511,99512,99514,99515,99516,99526,99550,99551,99553,99616,99617,99645,99679,99694,99712,99716,99717,99719,99720,99726,99735,99741,99743,99744,99802,99803,99814,99817,99830,99848,99849,99867,99869,99870,99872,99875,99876,99877,99878,99879,99880,99903,99909,99917,99946,99971,100004,100034,100065,100066,100067,100068,100080,100081,100082,100087,100098,100135,100174,100242,100243,100252,100253,100269,100278,100291,100298,100303,100304,100320,100324,100341,100343,100364,100365,100376,100378,100401,100402,100403,100413,100427,100454,100455,100456,100457,100458,100459,100460,100461,100465,100466,100470,100486,100511,100523,100524,100526,100527,100529,100530,100531,100532,100533,100544,100545,100548,100549,100572,100573,100575,100576,100577,100657,100681,100682,100683,100684,100685,100686,100687,100688,100689,100714,100715,100723,100724,100725,100763,100764,100779,100781,100819,100820,100821,100871,100872,100873,100874,100875,100882,100883,100891,100901,100903,100904,100911,100912,100914,100915,100916,100917,100918,100926,100965,101012,101029,101044,101076,101100,101128,101137,101144,101145,101159,101160,101161,101162,101209,101210,101211,101212,101231,101242,101345,101346,101387,101388,101389,101390,101395,101415,101471,101488,101489,101523,101533,101534,101535,101551,101566,101567,101584,101588,101589,101595,101596,101612,101623,101631,101635,101638,101677,101697,101706,101707,101709,101773,101774,101775,101776,101825,101840,101853,101857,101914,101915,101916,101917,101919,101940,101969,101970,101972,101975,101976,101993,101997,102004,102018,102057,102079,102080,102081,102094,102097,102117,102118,102140,102141,102143,102147,102151,102156,102167,102168,102174,102175,102176,102177,102194,102200,102211,102212,102215,102219,102221,102223,102230,102231,102232,102243,102265,102266,102268,102280,102283,102302,102303,102306,102307,102310,102320,102321,102322,102331,102337,102344,102345,102346,102357,102365,102382,102413,102421,102422,102425,102426,102439,102451,102467,102468,102506,102566,102572,102578,102580,102585,102587,102614,102638,102639,102640,102641,102642,102643,102644,102645,102646,102676,102713,102717,102718,102726,102758,102759,102760,102761,102763,102764,102765,102766,102767,102773,102813,102814,102815,102826,102833,102855,102856,102859,102866,102874,102925,103100,103107,103129,103130,103137,103138,103139,103140,103142,103166,103171,103172,103184,103196,103197,103198,103199,103200,103201,103202,103248,103249,103250,103251,103255,103256,103274,103275,103335,103350,103359,103382,103399,103401,103403,103433,103441,103442,103451,103460,103463,103467,103471,103472,103473,103474,103485,103495,103496,103497,103499,103500,103501,103534,103538,103549,103552,103553,103565,103566,103582,103583,103616,103617,103632,103638,103639,103640,103641,103642,103662,103665,103681,103682,103683,103698,103699,103700,103702,103703,103704,103712,103715,103726,103728,103730,103731,103732,103733,103734,103735,103759,103767,103774,103775,103776,103833,103857,103860,103862,103885,103893,103894,103895,103896,103911,103912,103913,103914,103935,103936,103937,103938,103972,103974,103975,104009,104010,104011,104028,104029,104030,104031,104041,104043,104044,104045,104047,104052,104055,104058,104077,104090,104094,104095,104096,104097,104098,104180,104182,104184,104203,104204,104205,104206,104208,104209,104210,104211,104213,104215,104216,104217,104219,104222,104223,104225,104239,104240,104242,104243,104244,104253,104254,104255,104256,104261,104263,104264,104265,104275,104276,104277,104288,104289,104290,104292,104294,104295,104309,104310,104317,104319,104324,104341,104407,104447,104453,104454,104457,104458,104459,104464,104479,104480,104481,104501,104515,104516,104533,104549,104560,104564,104578,104579,104581,104586,104591,104592,104598,104599,104600,104604,104605,104612,104614,104615,104631,104632,104644,104645,104646,104647,104658,104660,104664,104676,104716,104725,104899,104907,104908,104943,104952,104954,104955,104958,105011,105020,105021,105022,105023,105030,105046,105054,105127,105130,105162,105164,105165,105170,105197,105198,105201,105206,105207,105208,105215,105217,105226,105262,105274,105275,105298,105299,105301,105303,105304,105306,105329,105337,105367,105368,105384,105410,105412,105413,105414,105415,105416,105441,105444,105445,105498,105499,105500,105501,105502,105506,105507,105508,105509,105510,105511,105512,105513,105514,105515,105516,105517,105519,105520,105521,105522,105524,105525,105545,105546,105547,105548,105549,105550,105552,105553,105554,105555,105556,105557,105558,105559,105560,105561,105562,105563,105564,105565,105566,105567,105568,105569,105570,105571,105572,105574,105575,105576,105577,105584,105585,105586,105587,105588,105590,105591,105592,105593,105594,105595,105596,105597,105598,105599,105600,105601,105602,105603,105604,105605,105606,105607,105608,105609,105610,105611,105618,105619,105621,105640,105641,105642,105643,105644,105670,105671,105672,105685,105686,105687,105688,105689,105690,105723,105726,105728,105746,105762,105763,105809,105810,105811,105813,105814,105824,105827,105845,105847,105848,105929,105935,105961,105990,105995,106004,106006,106042,106073,106082,106120,106151,106209,106315,106379,106387,106388,106391,106483,106574,106597,106598,106628,106629,106630,106708,106739,106740,106741,106742,106743,106744,106745,106746,106747,106748,106769,106770,106771,106773,106774,106775,106835,106873,106877,106914,106915,106921,106947,107034,107045,107056,107063,107064,107126,107128,107133,107150,107151,107159,107160,107173,107176,107194,107203,107217,107218,107294,107300,107306,107311,107312,107325,107361,107362,107364,107365,107366,107368,107369,107370,107372,107373,107474,107484,107502,107504,107532,107533,107534,107535,107536,107556,107557,107560,107597,107598,107599,107605,107606,107617,107622,107624,107625,107626,107635,107637,107658,107668,107669,107670,107671,107702,107705,107713,107721,107722,107744,107759,107761,107763,107847,107865,107896,107906,107941,107942,107978,107986,107987,107988,107989,107997,108005,108013,108014,108015,108016,108017,108018,108033,108036,108056,108067,108098,108099,108108,108109,108127,108128,108130,108131,108132,108133,108137,108141,108144,108146,108149,108150,108153,108154,108155,108156,108174,108178,108189,108190,108218,108221,108222,108250,108278,108287,108297,108301,108311,108312,108319,108321,108323,108330,108331,108343,108344,108350,108351,108364,108366,108374,108375,108384,108385,108399,108402,108453,108454,108455,108456,108465,108466,108477,108478,108479,108514,108521,108532,108533,108535,108538,108547,108559,108593,108622,108623,108624,108625,108647,108686,108687,108714,108735,108739,108740,108741,108742,108743,108745,108746,108748,108749,108750,108751,108755,108756,108757,108758,108763,108765,108767,108775,108776,108778,108780,108781,108783,108784,108785,108788,108790,108793,108794,108808,108810,108811,108813,108814,108839,108840,108841,108842,108843,108844,108845,108846,108874,108875,108889,108908,108912,108924,108925,108926,108927,108929,108930,108931,108933,108934,108977,108978,108979,108980,108981,108982,108983,108984,108988,108989,109017,109018,109078,109082,109099,109102,109131,109132,109173,109174,109175,109202,109239,109240,109270,109271,109304,109315,109322,109383,109444,109445,109446,109447,109448,109452,109453,109454,109462,109463,109464,109491,109500,109501,109503,109506,109530,109551,109553,109554,109594,109595,109596,109605,109607,109613,109656,109697,109710,109714,109716,109717,109757,109760,109761,109762,109802,109822,109842,109853,109854,109855,109864,109873,109896,109918,109932,109949,109961,109967,109972,109973,109974,109978,109990,109991,109992,109997,109998,109999,110000,110022,110033,110034,110042,110043,110047,110084,110106,110203,110205,110209,110238,110239,110248,110252,110322,110325,110326,110334,110366,110368,110369,110370,110372,110373,110381,110383,110386,110395,110461,110463,110472,110473,110474,110516,110528,110529,110531,110532,110533,110541,110549,110551,110552,110553,110554,110601,110602,110603,110632,110642,110701,110787,110788,110789,110790,110791,110793,110795,110796,110797,110798,110799,110801,110803,110809,110814,110816,110825,110841,110842,110844,110845,110846,110847,110850,110851,110853,110879,110880,110907,110945,110946,110947,110948,110950,110951,110971,110972,110973,110974,110975,110976,110977,110978,110979,110986,110988,111025,111028,111029,111030,111051,111122,111140,111194,111206,111300,111305,111396,111500,111574,111616,111676,111702,111854,111928,111930,111934,111962,111964,112028,112088,112107,112108,112137,112142,112146,112158,112191,112194,112200,112204,112205,112210,112211,112212,112213,112214,112215,112216,112250,112279,112281,112286,112305,112306,112307,112308,112319,112320,112380,112422,112423,112424,112425,112427,112433,112434,112435,112436,112437,112438,112439,112446,112448,112449,112450,112451,112452,112453,112454,112455,112456,112519,112539,112540,112624,112648,112703,112748,112749,112768,112793,112902,113037,113170,113171,113199,113201,113208,113306,113310,113318,113319,113320,113321,113322,113323,113324,113325,113326,113369,113372,113446,113528,113605,113632,113633,113634,113635,113641,113676,113677,113735,113743,113744,113746,113764,113792,113822,113914,113932,113933,113939,113997,114008,114009,114017,114051,114178,114224,114235,114254,114256,114307,114315,114342,114368,114369,114370,114486,114488,114491,114492,114494,114495,114496,114497,114498,114499,114500,114502,114505,114513,114527,114544,114606,114644,114645,114731,114750,114877,114977,114978,114983,115001,115004,115005,115007,115009,115025,115050,115051,115052,115053,115055,115057,115099,115147,115180,115464,115533,115538,115539,115540,115541,115544,115545,115546,115547,115548,115552,115553,115556,115557,115558,115559,115561,115562,115563,115564,115567,115599,115625,115629,115721,115787,115956,115964,116283,116375,116376,116527,116644,116645,116752,116769,116771,116798,116833,116887,116974,117000,117016,117111,117112,117174,117175,117250,117347,117356,117358,117402,117403,117405,117406,117409,117411,117412,117413,117414,117470,117527,117543,117775,117776,117863,117969,118037,118042,118047,118048,118051,118079,118080,118162,118201,118203,118204,118286,118367,118375,118376,118377,118378,118379,118458,118599,118600,118699,118765,118766,118910,118927,118946,118964,118995,119096,119100,119178,119244,119252,119273,119301,119370,119544,119614,119615,119616,119653,119754,119769,119771,119809,119827,119851,119866,119881,119924,120127,120135,120189,120225,120257,120368,120406,120407,120408,120416,120417,120505,120506,120507,120533,120534,120555,120592,120593,120633,120685,120686,120812,120814,120847,120848,120915,120966,120975,120991,121019,121053,121064,121067,121068,121168,121189,121231,121234,121270,121296,121539,121569,121771,121777,121779,121843,121844,121847,121853,121854,121906,121912,121947,121950,121955,122040,122041,122134,122135,122168,122223,122287,122288,122300,122333,122342,122460,122487,122488,122489,122490,122491,122493,122590,122591,122592,122761,122784,122836,122844,122894,122917,122941,122970,123103,123104,123105,123106,123144,123145,123190,123313,123360,123368,123369,123374,123419,123420,123421,123422,123449,123520,123522,123525,123526,123527,123567,123574,123591,123830,123932,124105,124172,124195,124196,124198,124200,124201,124203,124302,124345,124348,124367,124368,124371,124409,124411,124412,124415,124416,124418,124420,124433,124438,124441,124462,124465,124466,124467,124468,124472,124474,124475,124476,124477,124478,124479,124481,124483,124484,124485,124487,124488,124489,124490,124491,124495,124496,124499,124500,124501,124504,124506,124507,124508,124509,124510,124511,124512,124513,124514,124522,124523,124525,124527,124528,124529,124531,124532,124533,124534,124535,124536,124539,124540,124544,124545,124547,124548,124551,124552,124553,124554,124555,124556,124558,124559,124560,124562,124563,124564,124568,124570,124573,124575,124577,124578,124580,124582,124583,124584,124586,124587,124592,124593,124594,124595,124596,124597,124598,124630,124631,124632,124633,124634,124653,124654,124655,124656,124659,124661,124662,124669,124794,124832,124834,124855,124856,124891,124901,124921,124989,124992,124996,124999,125251,125252,125253,125343,125437,125440,125441,125442,125443,125467,125524,125536,125537,125560,125630,125632,125662,125663,125671,125675,125676,126073,126155,126228,126250,126448,126504,126553,126561,126585,126708,126740,126757,126759,126760,126762,126916,127011,127014,127015,127034,127072,127118,127121,127169,127253,127254,127258,127260,127275,127276,127314,127340,127341,127342,127343,127427,127583,127612,127616,127627,127638,127639,127640,127641,127656,127743,127796,127799,127807,127856,127862,127864,127928,127938,127940,127944,127945,127946,127964,127966,128009,128010,128022,128030,128062,128087,128130,128134,128135,128156,128157,128158,128159,128165,128187,128188,128189,128190,128205,128208,128215,128216,128253,128256,128257,128265,128266,128267,128285,128307,128319,128345,128350,128414,128429,128430,128431,128433,128546,128558,128560,128561,128564,128565,128596,128612,128613,128614,128642,128668,128670,128672,128673,128674,128675,128676,128759,128762,128763,128764,128765,128791,128798,128846,128878,128879,128910,128911,128912,128913,128914,128915,128917,128918,128919,128923,128954,128964,128965,128987,128989,128992,128994,128998,129000,129004,129005,129009,129014,129015,129033,129034,129035,129061,129063,129064,129065,129066,129067,129068,129069,129070,129166,129170,129202,129244,129295,129304,129310,129313,129315,129344,129345,129348,129351,129364,129447,129471,129520,129554,129564,129565,129576,129589,129591,129603,129605,129612,129615,129638,129647,129650,129655,129710,129749,129800,129881,129883,129884,129949,129950,130068,130086,130148,130152,130153,130209,130247,130268,130272,130313,130335,130337,130338,130393,130403,130527,130528,130537,130601,130646,130651,130667,130686,130730,130923,130928,131052,131125,131127,131309,131314,131317,131318,131328,131349,131493,131500,131503,131506,131508,131601,131621,131629,131805,131808,131935,131936,131937,131938,131939,131942,131953,131954,131955,131956,132091,132154,132157,132158,132159,132344,132349,132723,132788,132799,132873,133043,133177,133199,133304,133508,133536,133627,133663,133720,133869,133951,134055,134118,134192,134277,134364,134371,134373,134397,134398,134399,134413,134474,134476,134478,134479,134499,134524,134552,134584,134589,134647,134694,134724,134770,134787,134901,134910,134928,134929,135013,135014,135058,135059,135060,135061,135062,135063,135064,135066,135074,135082,135083,135084,135139,135158,135160,135169,135202,135210,135225,135226,135250,135269,135283,135305,135306,135400,135435,135436,135438,135440,135457,135526,135527,135548,135583,135584,135586,135670,135699,135700,135702,135708,135717,135749,135783,135794,135865,135952,135957,135958,135959,135960,135962,135963,135964,135965,136044,136046,136139,136207,136208,136209,136210,136211,136212,136213,136215,136216,136217,136218,136219,136313,136314,136335,136367,136401,136402,136403,136437,136439,136454,136455,136456,136457,136458,136459,136461,136462,136463,136464,136473,136537,136538,136627,136628,136629,136631,136668,136708,136709,136713,136716,136719,136720,136721,136722,136723,136724,136725,136726,136727,136728,136729,136730,136782,136843,136865,136871,136872,136873,136934,136935,136942,136943,136944,136945,136947,136948,136949,136950,136951,136952,136953,136954,136956,136958,137028,137059,137060,137061,137062,137063,137064,137065,137066,137070,137073,137074,137077,137078,137079,137080,137081,137082,137083,137289,137329,137330,137334,137339,137340,137344,137347,137348,137349,137350,137351,137352,137353,137354,137355,137464,137466,137467,137468,137470,137472,137474,137478,137479,137480,137481,137482,137483,137484,137485,137493,137593,137600,137606,137607,137609,137611,137615,137617,137618,137619,137620,137621,137622,137678,137679,137680,137688,137689,137690,137691,137692,137693,137694,137695,137696,137697,137698,137699,137700,137701,137702,137782,137783,137784,137785,137786,137787,137791,137792,137793,137794,137795,137796,137797,137798,137841,137842,137843,137844,137845,137851,137852,137853,137854,137883,137890,137891,137896,137900,137902,137903,137904,137905,137906,138021,138022,138023,138024,138025,138026,138027,138028,138029,138030,138031,138032,138033,138034,138035,138036,138037,138038,138039,138040,138041,138042,138043,138044,138045,138092,138095,138096,138100,138102,138178,138217,138218,138219,138220,138221,138222,138224,138225,138226,138227,138228,138229,138230,138231,138232,138233,138234,138235,138236,138237,138238,138239,138240,138241,138323,138377,138378,138391,138392,138393,138527,138534,138586,138602,138605,138616,138621,138668,138847,138874,138914,139006,139007,139088,139089,139092,139165,139167,139168,139170,139183,139186,139188,139194,139221,139232,139270,139276,139332,139355,139369,139370,139371,139372,139374,139375,139478,139480,139486,139631,139632,139675,139676,139695,139763,139799,139804,139846,139854,139860,139861,139888,139891,139901,139942,140013,140039,140040,140059,140080,140081,140082,140083,140119,140195,140201,140227,140229,140231,140276,140277,140278,140279,140280,140281,140282,140288,140301,140341,140394,140457,140490,140515,140516,140519,140521,140522,140652,140719,140723,140732,140750,140758,140760,140811,140812,140848,140865,140866,140874,140896,140897,140907,140914,140959,141012,141016,141029,141045,141046,141049,141051,141052,141084,141085,141101,141126,141127,141155,141168,141169,141170,141173,141174,141175,141177,141180,141181,141183,141184,141185,141186,141187,141189,141190,141192,141193,141194,141195,141196,141212,141227,141228,141264,141362,141363,141365,141366,141367,141370,141371,141372,141374,141376,141409,141424,141460,141492,141507,141645,141665,141693,141696,141699,141710,141724,141729,141741,141767,141795,141796,141797,141798,141855,141856,141857,141859,141904,141946,141971,141972,141973,142025,142143,142193,142264,142267,142272,142273,142277,142279,142281,142282,142283,142284,142294,142326,142329,142337,142338,142340,142345,142346,142373,142382,142383,142385,142397,142398,142400,142401,142431,142432,142436,142437,142438,142439,142473,142477,142478,142480,142501,142555,142578,142694,142695,142696,142697,142763,142777,142834,142890,142903,142904,142919,142921,142978,142981,142983,142985,142987,142988,143243,143275,143276,143277,143332,143381,143404,143405,143406,143466,143518,143531,143666,143734,143781,143784,143786,143787,143815,143974,143976,143978,144015,144117,144118,144120,144126,144127,144128,144129,144190,144199,144201,144202,144233,144251,144259,144271,144369,144372,144375,144425,144433,144485,144500,144517,144537,144540,144544,144546,144548,144568,144570,144578,144639,144642,144680,144683,144693,144775,144795,145014,145015,145039,145045,145046,145050,145077,145083,145084,145089,145112,145161,145272,145300,145313,145314,145321,145388,145389,145390,145391,145392,145396,145468,145469,145471,145475,145478,145519,145531,145538,145591,145637,145733,145742,145768,145796,145866,145867,145868,145870,145871,145938,145970,146003,146024,146060,146064,146086,146118,146162,146196,146208,146293,146374,146519,146622,146670,146671,146672,146673,146674,146725,146784,146786,146788,146806,146808,146809,146812,146813,146814,146862,146863,147009,147134,147163,147223,147225,147233,147235,147236,147261,147262,147275,147288,147289,147452,147526,147545,147546,147680,147717,147718,147801,147832,147833,147835,147836,147845,147910,147911,148010,148044,148181,148256,148293,148337,148340,148526,148528,148595,148674,148714,148715,148717,148722,148759,148778,148887,148911,148977,148993,149186,149194,149213,149346,149409,149411,149421,149431,149452,149583,149596,149602,149659,149773,149774,149775,149780,149785,149789,149876,149892,149894,149964,149971,149972,150049,150077,150078,150098,150112,150113,150137,150183,150206,150257,150323,150364,150371,150428,150449,150701,150702,150711,150727,150816,150943,151052,151146,151266,151267,151273,151318,151530,151568,151569,151570,151571,151572,151592,151606,151620,151624,151658,151659,151773,151774,151797,151799,151800,151801,151921,151930,151933,151937,151946,151954,151958,151996,152018,152045,152089,152090,152093,152094,152095,152096,152103,152104,152105,152147,152148,152225,152236,152253,152286,152288,152289,152290,152298,152300,152381,152388,152389,152494,152497,152498,152499,152576,152604,152749,152750,152756,152807,152945,153003,153038,153040,153056,153079,153153,153381,153455,153456,153457,153465,153466,153473,153474,153476,153998,154161,154198,154236,154237,154370,154378,154382,154420,154531,154563,154601,154602,154612,154614,154615,154705,154706,154708,154709,154712,154713,154762,154769,154952,155011,155016,155038,155089,155096,155097,155099,155106,155111,155123,155223,155243,155287,155300,155301,155302,155303,155304,155365,155441,155471,155472,155505,155515,155526,155567,155573,155607,155608,155610,155611,155612,155632,155633,155655,155709,155747,155748,155846,155883,155931,155937,156057,156058,156060,156061,156159,156168,156170,156171,156172,156173,156174,156180,156197,156198,156199,156202,156205,156206,156207,156208,156260,156262,156275,156280,156289,156290,156295,156310,156311,156325,156337,156403,156441,156466,156467,156469,156470,156472,156474,156475,156476,156482,156535,156538,156545,156590,156631,156634,156635,156684,156685,156686,156687,156688,156689,156690,156692,156720,156721,156780,156886,156893,156894,156896,156903,156935,156936,156937,156940,156944,156946,156948,156988,157144,157187,157286,157300,157302,157303,157306,157313,157319,157353,157392,157455,157651,157654,157655,157656,157662,157663,157664,157665,157666,157692,157693,157722,157724,157733,157785,157867,157868,157885,157920,157927,157928,157933,157934,157935,157974,158005,158093,158098,158129,158207,158336,158355,158363,158364,158365,158366,158367,158368,158369,158370,158381,158418,158419,158420,158421,158422,158423,158428,158475,158510,158511,158512,158513,158514,158515,158516,158517,158518,158519,158539,158572,158574,158578,158585,158586,158589,158614,158625,158626,158627,158632,158655,158662,158665,158708,158732,158733,158734,158735,158771,158773,158833,158872,158908,158912,158939,158941,158960,158970,158986,159049,159057,159104,159128,159129,159223,159224,159230,159264,159307,159308,159430,159431,159432,159433,159435,159450,159451,159452,159468,159485,159580,159581,159582,159583,159584,159585,159586,159598,159620,159639,159641,159663,159673,159683,159744,159746,159747,159750,159753,159809,159893,159894,159895,159906,159908,159970,160044,160174,160177,160178,160179,160182,160183,160185,160187,160292,160293,160294,160336,160398,160403,160407,160458,160459,160460,160507,160548,160567,160568,160569,160570,160571,160619,160620,160755,160776,160862,160938,161082,161161,161274,161289,161320,161322,161377,161380,161400,161404,161405,161406,161562,161585,161610,161632,161718,161778,161816,161817,161819,161820,161821,161823,161824,161825,161826,161832,161850,161889,161899,161938,162010,162017,162022,162026,162029,162054,162114,162213,162232,162233,162258,162262,162263,162264,162265,162266,162292,162293,162296,162301,162336,162342,162358,162360,162362,162364,162367,162368,162369,162387,162389,162393,162394,162420,162448,162451,162452,162455,162456,162457,162459,162462,162477,162480,162530,162552,162614,162616,162617,162619,162634,162635,162763,162792,162927,162973,162974,163145,163147,163148,163149,163150,163151,163152,163153,163156,163157,163158,163159,163211,163226,163279,163322,163323,163324,163610,163611,163612,163613,163614,163615,163616,163618,163619,163620,163725,163781,163806,163830,163884,163900,163915,163916,164039,164116,164117,164119,164120,164121,164127,164128,164129,164131,164149,164150,164170,164173,164175,164176,164177,164197,164200,164201,164217,164239,164241,164242,164243,164244,164246,164278,164287,164292,164356,164357,164358,164359,164363,164364,164365,164368,164370,164371,164372,164373,164374,164375,164379,164399,164407,164411,164413,164414,164416,164418,164425,164434,164456,164468,164535,164568,164569,164585,164626,164636,164637,164646,164647,164650,164663,164677,164679,164686,164702,164755,164907,164925,164984,165068,165116,165118,165120,165140,165251,165252,165263,165321,165335,165336,165337,165338,165372,165373,165416,165418,165421,165430,165463,165478,165480,165483,165488,165505,165506,165518,165519,165521,165544,165545,165546,165547,165555,165556,165633,165635,165636,165639,165641,165642,165643,165647,165656,165686,165687,165690,165691,165692,165786,165809,165855,165857,165858,165859,165861,165862,165863,165877,165885,165886,165887,165888,165889,165890,165892,165895,165899,165900,165924,165925,165946,166013,166016,166022,166023,166024,166025,166033,166034,166043,166061,166077,166105,166109,166110,166111,166112,166114,166117,166118,166135,166141,166142,166155,166156,166159,166160,166161,166162,166195,166196,166198,166199,166201,166207,166230,166231,166234,166235,166246,166247,166248,166266,166307,166308,166309,166314,166315,166321,166322,166323,166324,166325,166347,166380,166397,166417,166420,166421,166424,166439,166441,166442,166444,166459,166465,166471,166472,166474,166475,166513,166534,166535,166540,166577,166578,166583,166588,166589,166590,166591,166592,166596,166599,166600,166601,166644,166649,166650,166652,166653,166654,166659,166660,166667,166668,166669,166670,166671,166672,166673,166674,166681,166696,166721,166730,166746,166748,166753,166756,166757,166760,166761,166762,166767,166771,166780,166789,166796,166818,166820,166824,166877,166950,166971,167044,167049,167064,167073,167074,167078,167096,167115,167117,167118,167119,167208,167213,167214,167245,167374,167375,167376,167377,167378,167379,167380,167381,167414,167425,167478,167481,167483,167485,167486,167487,167522,167541,167542,167560,167586,167596,167611,167612,167624,167634,167640,167652,167658,167693,167697,167710,167733,167759,167768,167794,167836,167840,167940,167941,167946,167951,167981,167993,167995,167996,168017,168019,168025,168046,168075,168088,168147,168157,168197,168199,168278,168287,168288,168321,168359,168396,168397,168398,168399,168486,168487,168527,168528,168529,168530,168531,168536,168575,168583,168632,168674,168690,168691,168692,168693,168695,168696,168697,168699,168787,168801,168865,169026,169045,169046,169047,169050,169053,169055,169056,169058,169076,169078,169081,169087,169088,169090,169093,169124,169132,169170,169172,169173,169177,169181,169182,169183,169241,169256,169257,169259,169278,169360,169420,169466,169558,169563,169621,169675,169818,169889,169892,169893,169894,169895,169896,169897,169898,169899,169900,169902,169903,169911,169912,169944,169945,169946,169947,169948,169956,169958,169959,169960,169961,169962,169978,170012,170022,170082,170181,170247,170248,170249,170253,170254,170504,170507,170539,170541,170542,170543,170544,170545,170548,170626,170634,170636,170639,170665,170750,170751,170752,170753,170754,170755,170757,170759,170760,170762,170763,170764,170765,170766,170767,170797,170804,170896,170972,170978,171037,171041,171044,171072,171261,171262,171309,171424,171425,171426,171430,171480,171545,171546,171548,171551,171560,171575,171576,171581,171659,171679,171748,171777,171816,171817,171818,171819,171820,171821,171851,171864,171866,171878,171880,171931,171956,171970,171971,171972,171973,171974,171976,171977,171978,171979,172133,172161,172164,172173,172179,172187,172194,172198,172199,172200,172201,172202,172203,172204,172205,172206,172207,172208,172209,172210,172211,172212,172213,172214,172215,172216,172217,172218,172219,172220,172221,172222,172226,172227,172228,172245,172289,172301,172302,172303,172304,172305,172306,172307,172308,172309,172310,172342,172343,172383,172384,172398,172399,172560,172562,172755,172853,172854,172855,172856,172857,172858,172859,172860,172861,172862,172863,172864,172865,172866,172909,172996,173015,173018,173019,173020,173022,173194,173202,173203,173229,173230,173257,173258,173259,173278,173279,173280,173353,173354,173413,173415,173439,173443,173444,173445,173483,173484,173485,173487,173488,173489,173490,173491,173492,173493,173494,173495,173496,173498,173501,173504,173613,173697,173736,173737,173791,173792,173795,173797,173831,173849,173850,173851,173852,173853,173854,173913,173965,173966,173967,174003,174004,174005,174008,174010,174011,174012,174013,174014,174016,174017,174018,174047,174064,174067,174076,174113,174114,174115,174117,174121,174179,174180,174182,174183,174186,174187,174188,174189,174190,174192,174193,174194,174200,174202,174204,174208,174209,174210,174211,174212,174213,174215,174216,174217,174218,174284,174297,174298,174299,174300,174301,174302,174303,174304,174305,174306,174307,174308,174309,174310,174311,174312,174313,174314,174315,174316,174317,174319,174335,174343,174396,174499,174546,174599,174602,174640,174731,174765,174766,174767,174769,174770,174771,174871,174953,174962,175264,175265,175291,175293,175417,175418,175419,175420,175421,175422,175423,175424,175425,175426,175427,175428,175429,175430,175431,175432,175433,175434,175435,175436,175452,175454,175455,175460,175462,175463,175464,175465,175466,175469,175470,175548,175549,175550,175556,175557,175627,175636,175639,175640,175642,175704,175733,175769,175770,175775,175776,175777,175780,175782,175784,175785,175786,175787,175788,175789,175793,175798,175800,175804,175806,175808,175824,175826,175878,175881,175916,175917,175923,175928,175930,175933,175936,175937,175946,175947,175948,175949,175956,175957,175961,175962,175964,175985,175986,175987,175988,175989,175990,176008,176014,176015,176029,176065,176093,176094,176095,176096,176097,176098,176100,176104,176105,176107,176108,176111,176130,176186,176196,176215,176231,176233,176234,176248,176249,176263,176268,176278,176279,176280,176281,176282,176283,176284,176286,176288,176289,176291,176295,176297,176298,176299,176307,176390,176400,176408,176444,176449,176452,176462,176493,176515,176516,176517,176565,176590,176591,176593,176594,176622,176623,176624,176646,176647,176648,176649,176661,176824,176830,176899,176942,176944,177018,177167,177168,177169,177170,177171,177234,177235,177320,177321,177322,177326,177328,177330,177427,177428,177429,177432,177433,177434,177435,177446,177450,177463,177524,177525,177526,177530,177532,177562,177563,177564,177565,177566,177569,177580,177591,177616,177633,177634,177635,177636,177637,177639,177642,177643,177661,177675,177677,177703,177711,177754,177789,177850,178024,178054,178099,178100,178101,178104,178129,178151,178189,178191,178192,178193,178194,178195,178196,178197,178201,178202,178203,178204,178207,178209,178213,178214,178216,178218,178232,178254,178257,178259,178260,178276,178277,178284,178285,178286,178287,178324,178325,178326,178327,178335,178337,178338,178359,178361,178362,178363,178364,178376,178385,178386,178390,178394,178396,178431,178432,178445,178482,178489,178490,178491,178494,178502,178528,178529,178530,178547,178583,178598,178600,178601,178611,178612,178614,178621,178632,178654,178655,178670,178678,178679,178692,178693,178694,178696,178697,178699,178704,178705,178706,178712,178744,178747,178748,178749,178750,178751,178752,178753,178755,178757,178758,178791,178792,178793,178794,178795,178807,178809,178823,178825,178827,178829,178833,178834,178846,178847,178849,178850,178854,178856,178858,178865,178866,178867,178870,178871,178875,178886,178890,178891,178892,178893,178897,178898,178899,178928,178929,178930,178932,178933,178934,178940,178941,178942,178943,178944,178960,178961,178962,178963,178964,178965,178967,178969,178978,178979,178980,178981,179009,179010,179017,179037,179038,179039,179041,179053,179054,179055,179061,179063,179064,179068,179070,179071,179078,179079,179106,179110,179111,179112,179114,179119,179120,179131,179132,179136,179145,179146,179168,179169,179170,179184,179187,179195,179196,179219,179220,179222,179224,179226,179227,179230,179234,179236,179237,179306,179307,179308,179309,179310,179314,179315,179339,179347,179348,179349,179350,179351,179377,179401,179403,179404,179405,179408,179409,179413,179415,179418,179419,179428,179429,179435,179436,179437,179438,179456,179457,179458,179459,179460,179464,179478,179479,179485,179486,179487,179488,179489,179492,179493,179495,179496,179497,179500,179509,179510,179511,179512,179513,179514,179550,179573,179574,179575,179640,179641,179642,179701,179702,179706,179733,179734,179843,179847,179848,179849,179866,179867,179868,179869,179900,179901,179912,179913,179919,179925,179930,179931,179944,179946,179950,179959,179960,179962,179963,179964,179965,180001,180020,180053,180054,180055,180057,180058,180077,180083,180098,180102,180105,180143,180151,180191,180193,180234,180235,180236,180237,180239,180241,180242,180253,180254,180293,180294,180295,180296,180298,180300,180301,180302,180303,180304,180316,180318,180319,180320,180321,180322,180329,180330,180331,180333,180347,180348,180349,180350,180351,180355,180357,180358,180359,180360,180361,180362,180364,180377,180378,180379,180380,180381,180385,180387,180388,180389,180395,180397,180398,180399,180402,180403,180426,180440,180441,180451,180452,180453,180454,180511,180538,180539,180541,180542,180561,180562,180577,180587,180591,180604,180605,180611,180612,180613,180614,180615,180616,180619,180620,180621,180622,180623,180624,180625,180627,180628,180629,180633,180635,180636,180638,180639,180641,180642,180645,180653,180674,180678,180679,180680,180681,180682,180699,180730,180731,180732,180733,180735,180736,180737,180754,180760,180765,180766,180767,180773,180774,180778,180779,180780,180782,180783,180785,180786,180787,180789,180810,180811,180815,180816,180817,180818,180819,180820,180821,180842,180844,180845,180847,180848,180849,180850,180851,180852,180856,180857,180879,180880,180881,180886,180888,180889,180908,180923,180924,180925,180926,180932,180933,180934,180938,180956,180969,180970,180971,180972,180988,180989,180990,181043,181044,181045,181053,181054,181072,181073,181074,181078,181079,181080,181100,181101,181105,181106,181107,181108,181109,181110,181114,181115,181116,181117,181118,181153,181154,181155,181184,181202,181203,181204,181236,181238,181239,181241,181243,181246,181257,181258,181270,181325,181327,181328,181330,181356,181357,181358,181359,181361,181362,181364,181495,181512,181513,181514,181515,181528,181541,181552,181663,181664,181780,181781,181782,181783,181844,181845,181846,181875,181876,181889,181890,181894,181895,181916,181917,181918,181919,181928,181929,181930,181931,181954,181955,181956,181957,181958,181959,182010,182012,182013,182014,182015,182017,182035,182036,182039,182040,182063,182064,182065,182066,182067,182085,182099,182100,182101,182102,182103,182106,182107,182133,182134,182172,182173,182174,182175,182179,182180,182182,182199,182201,182214,182227,182229,182246,182247,182248,182249,182250,182261,182295,182299,182300,182301,182313,182315,182317,182318,182319,182320,182321,182325,182326,182367,182368,182375,182376,182377,182430,182446,182448,182449,182486,182487,182488,182525,182526,182527,182550,182551,182552,182553,182554,182555,182587,182588,182589,182590,182605,182606,182607,182608,182609,182612,182613,182614,182615,182616,182617,182618,182619,182621,182622,182623,182624,182625,182626,182627,182628,182639,182647,182648,182649,182650,182654,182655,182656,182657,182675,182676,182677,182678,182679,182680,182681,182682,182684,182766,182767,182798,182799,182800,182801,182809,182810,182816,182829,182830,182853,182854,182855,182856,182857,182901,182906,182907,182908,182916,182931,182949,182950,182951,182973,182975,182979,182980,182993,183023,183031,183045,183047,183048,183090,183091,183109,183110,183112,183130,183133,183154,183155,183159,183162,183163,183164,183185,183186,183188,183199,183200,183245,183259,183260,183262,183292,183293,183294,183299,183300,183301,183302,183303,183304,183444,183445,183491,183492,183493,183560,183561,183562,183570,183571,183573,183575,183585,183611,183612,183614,183615,183636,183680,183712,183756,183757,183766,183767,183770,183771,183772,183797,183798,183799,183806,183809,183816,183817,183818,183820,183822,183823,183824,183828,183830,183831,183833,183834,183835,183836,183837,183838,183862,183904,183905,183906,183907,183908,183909,183924,183926,183928,183932,183933,183936,183948,183969,183970,183971,183980,183981,183983,183984,184005,184006,184007,184059,184060,184061,184062,184063,184064,184065,184066,184067,184068,184069,184071,184072,184073,184182,184183,184208,184319,184483,184484,184485,184507,184508,184511,184512,184513,184517,184518,184587,184588,184589,184593,184658,184659,184660,184661,184662,184663,184697,184698,184699,184700,184701,184703,184704,184705,184712,184745,184784,184803,184821,184822,184843,184844,184845,184846,184847,184848,184849,184851,184856,184857,184910,184912,184913,184914,184915,184920,184921,184947,184948,184954,184955,184956,184981,184983,184984,184985,184986,184987,184989,184990,184991,184992,184993,185019,185136,185137,185138,185140,185141,185142,185143,185144,185145,185147,185148,185149,185151,185152,185156,185157,185158,185162,185163,185177,185178,185179,185180,185181,185182,185183,185187,185191,185193,185194,185196,185197,185312,185313,185322,185323,185324,185326,185327,185331,185339,185340,185341,185342,185343,185383,185384,185385,185386,185387,185388,185404,185405,185406,185407,185408,185442,185443,185444,185445,185447,185448,185449,185450,185451,185452,185453,185454,185455,185506,185507,185509,185510,185512,185513,185514,185515,185517,185518,185519,185520,185547,185548,185549,185551,185552,185553,185554,185595,185644,185701,185703,185704,185706,185707,185708,185709,185710,185711,185712,185713,185714,185715,185719,185720,185722,185747,185748,185749,185751,185752,185753,185754,185757,185758,185759,185760,185772,185773,185774,185775,185776,185779,185780,185781,185784,185785,185786,185787,185788,185789,185790,185792,185808,185810,185811,185828,185829,185830,185831,185832,185833,185844,185845,185846,185872,185873,185876,185888,185889,185890,185891,185901,185902,185903,185904,185922,185923,185924,185925,185926,185927,185928,185929,185930,185954,185955,185962,185963,185966,185967,185968,185969,185970,185971,185972,185973,185974,185975,185981,185984,185985,185986,185988,185990,185991,185992,185993,186007,186009,186010,186011,186012,186013,186032,186033,186034,186035,186041,186042,186043,186044,186049,186050,186088,186089,186093,186095,186096,186097,186100,186124,186125,186126,186128,186129,186130,186131,186132,186136,186137,186138,186139,186140,186149,186150,186153,186154,186204,186205,186207,186212,186213,186215,186222,186223,186243,186246,186247,186248,186249,186250,186251,186252,186253,186254,186255,186256,186257,186258,186259,186294,186295,186296,186297,186298,186344,186345,186347,186348,186350,186351,186352,186357,186358,186359,186361,186375,186376,186379,186380,186381,186399,186418,186419,186420,186421,186422,186513,186514,186521,186522,186523,186670,186696,186702,186703,186751,186752,186753,186755,186757,186758,186759,186760,186762,186763,186764,186765,186766,186768,186770,186870,186871,186872,186873,186874,186979,186980,186981,186982,186983,186986,186987,186988,186989,187039,187185,187186,187187,187202,187203,187205,187225,187227,187228,187229,187233,187234,187235,187236,187238,187242,187243,187245,187247,187248,187249,187250,187251,187252,187266,187267,187272,187273,187274,187275,187287,187289,187290,187291,187292,187293,187294,187295,187296,187297,187298,187470,187471,187472,187474,187475,187477,187478,187577,187578,187579,187580,187581,187582,187583,187584,187592,187593,187594,187595,187596,187597,187598,187603,187604,187605,187606,187611,187635,187636,187656,187704,187748,187749,187750,187772,187782,187783,187784,187785,187786,187787,187794,187795,187796,187797,187798,187799,187800,187815,187873,187889,187925,187932,187933,187939,188006,188007,188011,188052,188054,188055,188056,188058,188072,188073,188099,188100,188102,188120,188178,188179,188180,188181,188182,188184,188192,188194,188197,188202,188206,188214,188216,188218,188219,188233,188235,188237,188239,188240,188247,188249,188250,188251,188252,188253,188254,188255,188256,188257,188258,188260,188261,188262,188263,188265,188266,188268,188269,188270,188271,188279,188294,188296,188304,188305,188339,188340,188341,188342,188464,188465,188466,188467,188481,188567,188693,188705,188707,188710,188711,188884,188885,188886,188935,188943,189074,189076,189077,189078,189079,189080,189081,189082,189083,189084,189085,189086,189087,189089,189159,189264,189266,189340,189468,189741,189782,189806,189886,189964,189965,189997,189998,190070,190130,190134,190135,190305,190306,190373,190374,190399,190413,190414,190415,190416,190449,190450,190453,190454,190455,190456,190457,190458,190459,190497,190590,190676,190765,190766,190810,190840,190901,190927,190941,190991,190993,191001,191002,191026,191060,191128,191130,191144,191228,191262,191295,191296,191298,191299,191301,191302,191310,191317,191343,191381,191404,191415,191432,191434,191435,191486,191524,191566,191573,191575,191578,191579,191622,191659,191707,191763,191784,191786,191790,191821,191822,191890,191901,191904,191938,191994,192005,192045,192046,192051,192060,192066,192125,192210,192309,192336,192372,192436,192493,192520,192579,192634,192715,192735,192814,192816,192859,192906,192951,192970,193025,193030,193073,193122,193148,193171,193190,193223,193228,193229,193256,193257,193312,193356,193391,193417,193418,193420,193421,193448,193483,193557,193595,193604,193626,193643,193677,193697,193719,193747,193769,193806,193847,193880,193912,193981,194014,194034,194038,194059,194153]}; /*__EMBEDDED_DELETED_IDS__*/

	const loadDeletedIds = async () => {
		if (__deletedSets) return __deletedSets;
		// 0. Встроенные данные (если установлен собранный бандл) — мгновенно, без сети.
		if (
			EMBEDDED_DELETED_IDS &&
			Array.isArray(EMBEDDED_DELETED_IDS.anime) &&
			Array.isArray(EMBEDDED_DELETED_IDS.manga)
		) {
			__deletedSets = {
				anime: new Set(EMBEDDED_DELETED_IDS.anime),
				manga: new Set(EMBEDDED_DELETED_IDS.manga),
			};
			log(
				`📋 Список удалённых (встроенный): anime=${EMBEDDED_DELETED_IDS.anime.length}, manga=${EMBEDDED_DELETED_IDS.manga.length}`,
			);
			return __deletedSets;
		}
		// 1. Кеш localStorage (с TTL)
		try {
			const raw = localStorage.getItem(DELETED_IDS_CACHE_KEY);
			if (raw) {
				const cached = JSON.parse(raw);
				if (cached && Date.now() - cached.ts < CONFIG.DELETED_IDS_TTL) {
					__deletedSets = {
						anime: new Set(cached.anime),
						manga: new Set(cached.manga),
					};
					log(
						`📋 Список удалённых из кеша: anime=${cached.anime.length}, manga=${cached.manga.length}`,
					);
					return __deletedSets;
				}
			}
		} catch (e) {
			debug("deleted-ids: чтение кеша не удалось", e);
		}
		// 2. Сеть
		try {
			const res = await fetchWithTimeout(CONFIG.DELETED_IDS_URL);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			const anime = Array.isArray(data.anime) ? data.anime : [];
			const manga = Array.isArray(data.manga) ? data.manga : [];
			__deletedSets = { anime: new Set(anime), manga: new Set(manga) };
			try {
				localStorage.setItem(
					DELETED_IDS_CACHE_KEY,
					JSON.stringify({ ts: Date.now(), anime, manga }),
				);
			} catch (e) {
				debug("deleted-ids: запись кеша не удалась", e);
			}
			log(`📋 Список удалённых загружен: anime=${anime.length}, manga=${manga.length}`);
			return __deletedSets;
		} catch (e) {
			error("Не удалось загрузить список удалённых тайтлов:", e.message);
			// Пустой набор -> работаем в спекулятивном режиме (как без списка).
			__deletedSets = { anime: new Set(), manga: new Set() };
			return __deletedSets;
		}
	};

	const isListLoaded = () =>
		__deletedSets !== null &&
		(__deletedSets.anime.size > 0 || __deletedSets.manga.size > 0);

	const isKnownDeleted = (id, type) => {
		if (!__deletedSets) return false;
		const set = type === "anime" ? __deletedSets.anime : __deletedSets.manga;
		return set.has(Number(id));
	};

	// === --------------------------------------- ===
	// === Корректная работа кнопок Назад / Вперёд ===
	// === --------------------------------------- ===
	// После восстановления мы делаем document.write — это убивает Turbolinks.
	// История же содержит записи pushState/Turbolinks, для которых back/forward
	// шлёт popstate, а обрабатывать его уже некому: URL меняется, а контент нет.
	// Решение: если SPA уничтожен — на popstate делаем честную полную загрузку.
	let __spaDestroyed = false;
	const onPopState = () => {
		if (__spaDestroyed) location.reload();
	};
	// Идемпотентно: одинаковый listener браузер не добавит повторно. Переустанавливаем
	// после document.write на случай, если window-listener был сброшен.
	const installPopstateGuard = () => window.addEventListener("popstate", onPopState);

	// Спекулятивный префетч. Кеш + in-flight исключают дубли; лимит in-flight
	// не даёт устроить "шторм" запросов при быстром наведении на каталог.
	const PREFETCH_MAX_INFLIGHT = 4;
	const prefetchEntity = (id, type) => {
		const key = `${type}_${id}`;
		getPageAssetsCached().catch(() => {}); // ассеты дёшевы (кешируются 1 раз)
		if (gqlCache.get(key) || __gqlInFlight.has(key)) return;
		if (__gqlInFlight.size >= PREFETCH_MAX_INFLIGHT) return;
		loadHeavyGQL(id, type).catch((e) =>
			debug(`Префетч GQL ${key} не удался: ${e.message}`),
		);
	};
	const prefetchFromHref = (href) => {
		const parsed = parseEntityLink(href);
		if (!parsed) return;
		// Список загружен -> греем ТОЛЬКО реально удалённые (ноль лишних запросов).
		// Списка нет -> спекулятивный режим (греем любой тайтл, как фолбэк).
		if (isListLoaded() && !isKnownDeleted(parsed.id, parsed.type)) return;
		prefetchEntity(parsed.id, parsed.type);
	};

	/**
	 *
	 * @param {Number} topicId ID топика, откуда запросить комментарии.
	 * @param {Number} maxComments Кол-во комментариев для загрузки.
	 * @returns {Promise<allComments>}
	 */
	// Размер страницы /api/comments (максимум API). Страницы перекрываются на 1
	// (последний коммент страницы повторяется первым на следующей) -> дедуп по id.
	const COMMENTS_PER_PAGE = 30;
	const COMMENTS_INITIAL = 3; // сколько показываем по умолчанию
	const COMMENTS_LOAD_STEP = 10; // сколько догружаем за один клик

	// Возвращает массив комментов (новые -> старые), начиная со страницы startPage,
	// дедуплицируя по id. seen — общий набор уже виденных id (для догрузки).
	const fetchComments = async (
		topicId,
		maxComments = CONFIG.COMMENTS_LIMIT,
		startPage = 1,
		seen = new Set(),
	) => {
		if (!topicId) return [];
		const all = [];
		let page = startPage;
		while (all.length < maxComments) {
			const batch = await apiRequest(
				`/comments?commentable_id=${topicId}&commentable_type=Topic&page=${page}&limit=${COMMENTS_PER_PAGE}&order=created_at&order_direction=desc`,
			);
			if (!Array.isArray(batch) || batch.length === 0) break;
			let added = 0;
			for (const c of batch) {
				if (c && !seen.has(c.id)) {
					seen.add(c.id);
					all.push(c);
					added++;
				}
			}
			if (added === 0) break; // пришли одни дубли -> конец списка
			page++;
		}
		return all.slice(0, maxComments);
	};

	/**
	 * Получает статус пользователя для конкретного тайтла.
	 * @param {Object} user - Объект пользователя.
	 * @param {number|string} targetId - ID аниме/манги.
	 * @param {string} targetType - "anime" или "manga".
	 * @returns {Promise<Object|null>} Объект рейта или null.
	 */
	const fetchUserRate = async (user, targetId, targetType) => {
		if (!user || !user.USER_ID) return null;

		// API требует "Anime" или "Manga" с большой буквы
		const typeUpper = (targetType.toLowerCase() === 'anime') ? 'Anime' : 'Manga';

		try {
			const res = await apiRequest(`/v2/user_rates?user_id=${user.USER_ID}&target_id=${targetId}&target_type=${typeUpper}`);

			// API возвращает массив. Если статус есть, он первый.
			if (Array.isArray(res) && res.length > 0) {
				return res[0];
			}
			return null;
		} catch (e) {
			error("[404Fix] fetchUserRate error:", e);
			return null;
		}
	};

	/**
	 * @description Получает полные данные сущности через кеш или 2 параллельных GraphQL запроса (Main + Details)
	 */
	const getEntityData = async (id, type, displayType, assetsPromise) => {
		log(`📡 Загрузка данных: ${type} ID: ${id}`);

		const isAnime = type === "anime";
        const isRanobe = displayType === 'ranobe';
		const missingImg = "/assets/globals/missing_preview.jpg";

		// Локальная функция, которая ДОЖИДАЕТСЯ парсинга донора
		const fetchUserRateLocal = async () => {
			const assets = await assetsPromise;
			const user = assets.USER_DATA;
			if (!user || !user.USER_ID) return null;

			const targetType = isAnime ? "Anime" : "Manga";
			return apiRequest(`/v2/user_rates?user_id=${user.USER_ID}&target_id=${id}&target_type=${targetType}`);
		};

		const similarCacheKey = `${type}_${id}`;
		const fetchSimilar = async () => {
			let cached = similarCache.get(similarCacheKey);
			if (cached) {
				log(`📦 Similar загружен из кеша (localStorage) для ${type} ${id}`);
				return cached;
			}
			const res = await apiRequest(`/${type}s/${id}/similar`);
			similarCache.set(similarCacheKey, res);
			return res;
		};

		// Тяжёлый GraphQL: кеш и дедупликацию берёт на себя loadHeavyGQL
		// (общий с префетчем — если данные уже прогреты, вернутся мгновенно).
		const fetchHeavyGQL = () => loadHeavyGQL(id, type);

		// 1. Запускаем все процессы параллельно
		const [heavyResult, newsResult, similarResult, userRateResult] =
			await Promise.allSettled([
				fetchHeavyGQL(),
				apiRequest(`/topics?forum=news&linked_type=${isAnime ? "Anime" : "Manga"}&linked_id=${id}&limit=30&order=comments_count&order_direction=desc`),
				fetchSimilar(), // Функция similarCache из прошлого сообщения
				fetchUserRateLocal() // Функция с ожиданием assetsPromise из прошлого сообщения
			]);

		// 2. Проверка основных данных
		if (heavyResult.status === "rejected" || !heavyResult.value.main.data) {
			throw new Error("Main GraphQL request failed");
		}

		// Достаем данные из ответов (обращаемся к нашему heavyResult)
		const mainDataRoot = heavyResult.value.main.data;
		const detailsDataRoot = heavyResult.value.details?.data || null;

		const mainList = isAnime ? mainDataRoot.animes : mainDataRoot.mangas;
		const detailsList = detailsDataRoot
			? isAnime
				? detailsDataRoot.animes
				: detailsDataRoot.mangas
			: [];

		if (!mainList || mainList.length === 0) {
			throw new Error("404: Entity not found");
		}

		// 3. МЕРДЖИМ (Объединяем) два объекта в один
		const mainEntity = mainList[0];
		const detailsEntity = detailsList[0] || {}; // Если второй запрос упал, будет пустой объект

		const entity = { ...mainEntity, ...detailsEntity };

        // ====================== JIKAN FALLBACK ======================
        // Заменяем удалённые РКН-ом арты Shikimori на изображения с MAL
        if (entity.malId) {
            log(`🌐 Запрашиваем арты с Jikan API (MAL ${entity.malId})...`);
            const jikanMedia = await fetchJikanMedia(entity.malId, isAnime);

            // Постер
            if (jikanMedia.poster) {
                entity.poster = entity.poster || {};
                entity.poster.originalUrl = jikanMedia.poster;
                entity.poster.mainUrl = jikanMedia.poster;
                entity.poster.miniAltUrl = jikanMedia.poster;
                debug("✅ Постер заменён на Jikan");
            }

            // Скриншоты (приоритет Jikan, т.к. на Shiki их чаще всего вырезали)
            if (jikanMedia.screenshots.length > 0) {
                entity.screenshots = jikanMedia.screenshots;
                debug(`✅ Скриншоты (${jikanMedia.screenshots.length} шт.) взяты с Jikan`);
            }
        }
        // ============================================================

		let listStatusData = null;
        if (userRateResult.status === "fulfilled" && Array.isArray(userRateResult.value)) {
            // API возвращает массив. Если статус есть, берем первый элемент.
            if (userRateResult.value.length > 0) {
                listStatusData = userRateResult.value[0];
            }
        }

		// 4. Комментарии + реальное общее число (из топика).
		const topicId = entity.topic ? entity.topic.id : null;
		let comments = [];
		let commentsTotal = 0;
		if (topicId) {
			try {
				const [fetched, topicInfo] = await Promise.all([
					fetchComments(topicId, COMMENTS_INITIAL),
					apiRequest(`/topics/${topicId}`).catch(() => null),
				]);
				comments = fetched || [];
				// comments_count топика = настоящее число комментов (а не хардкод в шаблоне).
				commentsTotal =
					topicInfo && Number.isFinite(topicInfo.comments_count)
						? topicInfo.comments_count
						: comments.length;
			} catch (err) {
				commentsTotal = comments.length;
			}
		}

		// 5. Обработка Ролей
		const processRoles = () => {
			const result = { main: [], supporting: [], staff: [] };

			if (entity.characterRoles) {
				entity.characterRoles.forEach((role) => {
					const char = role.character;
					if (!char) return;

					const imgUrl = char.image ? char.image.mainUrl : missingImg;
					const originalUrl = char.image
						? char.image.originalUrl
						: missingImg;
					const x48Url = char.image
						? char.image.miniAltUrl
						: missingImg;

					const mappedRole = {
						roles: role.rolesEn,
						roles_russian: role.rolesRu,
						character: {
							id: char.id,
							name: char.name,
							russian: char.russian,
							url: char.url,
							image: {
								preview: imgUrl,
								x96: imgUrl,
								x48: x48Url,
								original: originalUrl,
							},
						},
					};
					if (role.rolesEn.includes("Main"))
						result.main.push(mappedRole);
					else result.supporting.push(mappedRole);
				});
			}

			if (entity.personRoles) {
				entity.personRoles.forEach((role) => {
					const person = role.person;
					if (!person) return;

					const imgUrl = person.image
						? person.image.mainUrl
						: missingImg;
					const originalUrl = person.image
						? person.image.originalUrl
						: missingImg;
					const x48Url = person.image
						? person.image.miniAltUrl
						: missingImg;

					const mappedRole = {
						roles: role.rolesEn,
						roles_russian: role.rolesRu,
						person: {
							id: person.id,
							name: person.name,
							russian: person.russian,
							url: person.url,
							image: {
								preview: imgUrl,
								x96: imgUrl,
								x48: x48Url,
								original: originalUrl,
							},
						},
					};
					result.staff.push(mappedRole);
				});
			}
			return result;
		};

		const rolesData = processRoles();

		// 6. Обработка Related
		const processRelated = () => {
			if (!entity.related) return [];
			return entity.related
				.map((rel) => {
					const item = rel.anime || rel.manga;
					if (!item) return null;

					// GraphQL отдаёт poster:null для удалённых 18+ тайтлов, НО файлы постеров
					// /system/ остаются доступны. Берём URL из GraphQL, иначе строим по шаблону.
					const relType = rel.anime ? "animes" : "mangas";
					const posterUrl =
						(item.poster && item.poster.mainUrl) ||
						`/system/${relType}/preview/${item.id}.jpg`;
					const posterX48 =
						(item.poster && item.poster.miniAltUrl) ||
						`/system/${relType}/x48/${item.id}.jpg`;

					return {
						id: rel.id,
						relationKind: rel.relationKind,
						relation_russian: rel.relationText,
						anime: rel.anime
							? {
									id: rel.anime.id,
									name: rel.anime.name,
									russian: rel.anime.russian,
									kind: rel.anime.kind,
									url: rel.anime.url,
									episodes: rel.anime.episodes,
									aired_on: rel.anime.airedOn
										? `${rel.anime.airedOn.year}-01-01`
										: null,
									image: {
										preview: posterUrl,
										x96: posterUrl,
										x48: posterX48,
									},
								}
							: null,
						manga: rel.manga
							? {
									id: rel.manga.id,
									name: rel.manga.name,
									russian: rel.manga.russian,
									kind: rel.manga.kind,
									url: rel.manga.url,
									volumes: rel.manga.volumes,
									chapters: rel.manga.chapters,
									aired_on: rel.manga.airedOn
										? `${rel.manga.airedOn.year}-01-01`
										: null,
									image: {
										preview: posterUrl,
										x96: posterUrl,
										x48: posterX48,
									},
								}
							: null,
					};
				})
				.filter(Boolean);
		};

		const similarData =
			similarResult.status === "fulfilled" ? similarResult.value : [];

		// 7. Сборка финального объекта
		const finalData = {
			// anime / manga / ranobe
			TYPE: displayType || type,
			// Anime / Manga / Ranobe
			TYPE_UP: isAnime ? "Anime" : (isRanobe ? "Ranobe" : "Manga"),
			// animes / mangas / ranobe
			TYPE_M: isAnime ? "animes" : (isRanobe ? "ranobe" : "mangas"),
			// https://shiki.one/api/doc/2.0/user_rates/index
			LIST_STATUS: listStatusData ? {
                id: listStatusData.id,
                status: listStatusData.status, // planned, watching, rewatching, completed, on_hold, dropped
                score: listStatusData.score,
                episodes: listStatusData.episodes,
                chapters: listStatusData.chapters,
                volumes: listStatusData.volumes,
                text: listStatusData.text,
                rewatches: listStatusData.rewatches,
                created_at: listStatusData.created_at,
                updated_at: listStatusData.updated_at
            } : [],
			INFO: {
				ID: entity.id,
				EPISODES_TOTAL: entity.episodes || 0,
				CHAPTERS_TOTAL: entity.chapters || 0,
				VOLUMES_TOTAL: entity.volumes || 0,
				RU_NAME: entity.russian || entity.name,
				EN_NAME: entity.english || entity.name,
				TYPE: entity.kind,
				STATUS: getStatusInfo(entity.status).text,
				STATUS_CLASS: getStatusInfo(entity.status).class,
				SCORE: entity.score,
				DESCRIPTION: entity.descriptionHtml,
				TOPIC_ID: topicId,
				COMMENTS_TOTAL: commentsTotal,
				GENRES: entity.genres || [],
				MYANIMELIST_ID: entity.malId,
				DATE_RANGE: formatDates(entity.airedOn, entity.releasedOn).dateRange,
				DATE_TOOLTIP: formatDates(entity.airedOn, entity.releasedOn).tooltip,

				COUNT_LABEL: isAnime ? "Эпизоды" : (isRanobe ? "Тома / Главы" : "Тома/Главы"),
				COUNT_VALUE: isAnime
					? entity.episodes || "?"
					: `${entity.volumes || "?"} / ${entity.chapters || "?"}`,
				DURATION_BLOCK: isAnime
					? `<div class='line-container'><div class='line'><div class='key'>Длительность:</div><div class='value'>${
							entity.duration || "?"
						} мин.</div></div></div>`
					: "",

				ORG_LABEL: isAnime ? "Студия" : (isRanobe ? "Автор оригинала" : "Издатель"),
				ORGANIZATIONS: isAnime
					? entity.studios || []
					: entity.publishers || [],
			},
			POSTER: entity.poster ? entity.poster.originalUrl : "",

			RATINGS: {
				USER_SCORES: entity.scoresStats || [],
				USER_STATUS_STATS: entity.statusesStats || [],
			},

			// Медиа и Озвучка (превращаем строки в объекты {name: ...})
			VIDEOS: {
				// GraphQL возвращает массив строк ["a", "b"], а рендерер ждет [{name: "a"}, ...]
				SUBTITLES: isAnime
					? (entity.fansubbers || []).map((n) => ({ name: n }))
					: [],
				DUBBING: isAnime
					? (entity.fandubbers || []).map((n) => ({ name: n }))
					: [],
				LIST: entity.videos || [],
			},
			SCREENSHOTS: entity.screenshots || [],

			COMMENTS: comments.map((c) => ({
				id: c.id,
				html_body: c.html_body || (c.body ? c.body : ""),
				user_id: c.user_id,
				user: c.user ? c.user.nickname : "Гость",
				user_url: c.user ? c.user.url : "#",
				avatar:
					c.user && c.user.image
						? c.user.image.x48
						: c.user
							? c.user.avatar
							: "",
				created_at: c.created_at,
			})),

			NEWS:
				newsResult.status === "fulfilled"
					? newsResult.value.map((t) => ({
							id: t.id,
							topic_title: t.topic_title,
							link: `/forum/news/${t.id}`,
						}))
					: [],

			EXTERNAL_LINKS: entity.externalLinks
				? entity.externalLinks.map((l) => ({
						url: l.url,
						kind: l.kind,
						site: l.kind.replace(/_/g, " "),
					}))
				: [],

			SIMILAR_ANIMES: isAnime ? similarData.slice(0, 12) : [],
			SIMILAR_MANGAS: !isAnime ? similarData.slice(0, 12) : [],
			RELATED: processRelated(),
			ROLES: rolesData,
		};

		log(`✅ Обработка данных завершена для ${type} ID: ${id}`);
		debug(finalData);
		const sizeBytes = new Blob([JSON.stringify(finalData)]).size;
		log(`⚖️ Размер данных этого тайтла: ${(sizeBytes / 1024).toFixed(2)} KB`);
		return finalData;
	};

	// === ---------------- ===
	// === Модуль отрисовки ===
	// === ---------------- ===

	/**
	 * @description Генерирует HTML с кнопкой "Показать еще", если элементов больше лимита.
	 * @param {Array<string>} itemsArray - Массив HTML-строк элементов.
	 * @param {number} limit - Сколько элементов показывать сразу.
	 * @param {string} label - Текст кнопки (например, "показать всех").
	 * @param {boolean} isInline - Если true, скрытый блок будет inline (для тегов), иначе block.
	 * @returns {string} Итоговый HTML.
	 */
	const renderExpandable = (
		itemsArray,
		limit = 2,
		label = "показать всех",
	) => {
		if (!Array.isArray(itemsArray) || itemsArray.length === 0) return "";

		if (itemsArray.length <= limit) {
			return itemsArray.join("");
		}

		const visibleItems = itemsArray.slice(0, limit).join("");
		const hiddenItems = itemsArray.slice(limit).join("");

		return `
            <div class="expandable-wrapper">
                <div class="expandable-content">
                    ${visibleItems}<span class="b-show_more-content" style="display: none;">${hiddenItems}</span>
                </div>
                <div class="expandable-controls" style="clear: both; margin-top: 8px; width: 100%;">
                    <div class="b-show_more" style="cursor: pointer;">+ ${label}</div>
                    <div class="b-show_more hide-more" style="display: none; cursor: pointer;">— спрятать</div>
                </div>
            </div>
        `;
	};

	/**
	 * Рендерит блок связанных произведений.
	 * @param {Array} relatedData - Массив объектов из /api/animes/:id/related.
	 * @param {Object} currentUser - Объект текущего пользователя.
	 * @returns {string} Готовый HTML-блок.
	 */
	const renderRelatedBlock = (relatedData, currentUser) => {
		if (!Array.isArray(relatedData) || relatedData.length === 0) {
			return '<div class="cc" style="text-align: center; padding: 20px; color: #666; font-style: italic;">Нет информации о связанных произведениях.</div>';
		}

		const visibleCount = CONFIG.RELATED_VISIBLE_COUNT;
		const visibleItems = relatedData.slice(0, visibleCount);
		const hiddenItems = relatedData.slice(visibleCount);

		// Очередь для обновления статусов [ {id, type, domId} ]
		const updateQueue = [];

		const renderItem = (item) => {
			const entry = item.anime || item.manga;
			if (!entry) return "";

			const type = item.anime ? "anime" : "manga";
			const typePascalCase = type.charAt(0).toUpperCase() + type.slice(1);
			const typePlural = entry.url.startsWith("/ranobe") ? "ranobe" : (type === "anime" ? "animes" : "mangas");

			const url = getFullUrl(entry.url);
			const relationText = item.relation_russian;
			const image = entry.image?.preview ? getFullUrl(entry.image.preview) : "/assets/globals/missing_mini.png";
			const image2x = entry.image?.x96 ? getFullUrl(entry.image.x96) : image;
			const kindText = (entry.kind || "").replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || "Неизвестно";
			const year = entry.aired_on?.split("-")[0] || entry.released_on?.split("-")[0] || "";

			// 1. Генерируем кнопку в состоянии "Добавить" (null)
			// Генерируем уникальный ID контейнера, чтобы потом найти его и обновить
			const containerUniqueId = `ur-related-${entry.id}-${Math.floor(Math.random() * 10000)}`;

			const userId = currentUser ? currentUser.USER_ID : null;
			const initialButtonHtml = renderUserRateButton(entry.id, typePascalCase, userId, null);

			// 2. Добавляем в очередь на обновление (если юзер залогинен)
			if (currentUser) {
				updateQueue.push({
					targetId: entry.id,
					targetType: typePascalCase,
					domId: containerUniqueId
				});
			}

			return `
			<div class="b-db_entry-variant-list_item" data-id="${entry.id}" data-text="${entry.name}" data-type="${type}" data-url="${url}">
				<a class="image bubbled" href="${url}">
					<picture><img alt="${entry.russian || entry.name}" src="${image}" srcset="${image2x} 2x" onerror="this.onerror=null;this.removeAttribute('srcset');this.src='/assets/globals/missing_mini.png';"></picture>
				</a>
				<div class="info">
					<div class="name">
						<a class="b-link bubbled" href="${url}">
							<span class="name-en">${entry.name}</span>
							<span class="name-ru">${entry.russian || entry.name}</span>
						</a>
					</div>
					<div class="line">
						<div class="value">
							<a class="b-tag" href="/${typePlural}/kind/${entry.kind}">${kindText}</a>
							${year ? `<a class="b-tag" href="/${typePlural}/season/${year}">${year} год</a>` : ""}
							<div class="b-anime_status_tag other">${relationText}</div>
						</div>
					</div>
					<div class="user_rate-container" id="${containerUniqueId}">
						${initialButtonHtml}
					</div>
				</div>
			</div>`;
		};

		let html = `<div class="cc">${visibleItems.map(renderItem).join("")}</div>`;

		if (hiddenItems.length > 0) {
			html += `<div class="b-show_more unprocessed">+ показать остальное (${hiddenItems.length})</div>`;
			html += `<div class="b-show_more-more" style="display: none;">${hiddenItems.map(renderItem).join("")}<div class="hide-more">— спрятать</div></div>`;
		}

		// --- САМООБНОВЛЕНИЕ ---
		// Запускаем асинхронный процесс, который отработает ПОСЛЕ того, как HTML будет вставлен на страницу (document.write).
		if (updateQueue.length > 0) {
			setTimeout(async () => {
				log(`🔄 [Related] Начинаю обновление статусов для ${updateQueue.length} элементов...`);

				// Используем Promise.all или последовательно (зависит от мощности apiRequest).
				// apiRequest имеет очередь, так что можно кидать все сразу, они выстроятся.

				// Вариант: Запускаем все запросы параллельно (в очередь) и обновляем по мере прихода
				updateQueue.forEach(async (task) => {
					const rate = await fetchUserRate(currentUser, task.targetId, task.targetType);

					// Если статус есть (не null), обновляем кнопку
					if (rate) {
						const container = document.getElementById(task.domId);
						if (container) {
							const newHtml = renderUserRateButton(task.targetId, task.targetType, currentUser.USER_ID, rate);
							container.innerHTML = newHtml;
						}
					}
				});

				log("[Related] Все статусы обновлены");
			}, 100); // Небольшая задержка, чтобы DOM точно успел построиться после document.write
		}

		return html;
	};

	const renderScreenshotsAndVideos = (screenshots, videos) => {
		let html = "";

		// --- 1. Скриншоты ---
		if (Array.isArray(screenshots) && screenshots.length > 0) {
			// Формируем массив HTML-строк для каждого скриншота
			const screenshotItems = screenshots.map((scr, index) => {
				const preview = getFullUrl(scr.x166Url);
				const original = getFullUrl(scr.originalUrl);
				const title = `Кадр ${index + 1}`; // Можно добавить название аниме, если прокинуть его сюда

				return `
                    <a class="c-screenshot b-image entry-${index}" href="${original}" target="_blank" rel="noopener noreferrer" title="${title}">
                        <img src="${preview}" alt="${title}" loading="lazy" style="height: 100px; object-fit: cover; margin: 2px;">
                    </a>
                `;
			});

			// Оборачиваем в expandable (показываем 4, остальные скрываем)
			// Важно: isInline = true, чтобы картинки шли в ряд
			const screenshotsHtml = renderExpandable(
				screenshotItems,
				4,
				"показать все кадры",
			);

			html += `
                <div class="block">
                    <div class="subheadline">Кадры</div>
                    <div class="cc m0 c-screenshots">
                        ${screenshotsHtml}
                    </div>
                </div>
            `;
		}

		// --- 2. Видео ---
		if (Array.isArray(videos) && videos.length > 0) {
			const videoItems = videos.map((vid, index) => {
				const name = vid.name || vid.kind.toUpperCase();
				// Используем playerUrl если есть, иначе url
				// const link = vid.playerUrl || vid.url;
				// В твоем примере API imageUrl пустой ("//img..jpg"), поэтому лучше поставить заглушку или убрать картинку
				const thumb =
					vid.imageUrl && vid.imageUrl.length > 10
						? vid.imageUrl
						: "/assets/globals/missing_video.png";

				// ВАЖНО: Тут можно поменять target="_blank" на вызов своего плеера
				return `
                    <div class="b-video c-video entry-${index}" style="display: inline-block; width: 180px; margin: 5px; vertical-align: top;">
                        <a class="video-link" href="${
							vid.playerUrl
						}" target="_blank" rel="noopener noreferrer"
                           style="display: block; width: 100%; height: 100px; background: #000; position: relative; overflow: hidden;">
                            <!-- Если есть картинка, можно вставить img, иначе просто черный квадрат с иконкой Play -->
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px;">▶</div>
                        </a>
                        <span class="name" title="${name}" style="display: block; font-size: 11px; line-height: 1.2; margin-top: 3px;">
                            ${name}
                        </span>
                        <span class="marker" style="font-size: 10px; color: #999;">${vid.kind.toUpperCase()}</span>
                    </div>
                `;
			});

			// Показываем 3 видео, остальные скрываем
			const videosHtml = renderExpandable(
				videoItems,
				3,
				"показать все видео",
			);

			html += `
                <div class="block">
                    <div class="subheadline">Видео</div>
                    <div class="cc m0 c-videos">
                        ${videosHtml}
                    </div>
                </div>
            `;
		}

		return html;
	};

	/**
	 * --- УТИЛИТА: Рендер рейтинга ---
	 * Создает DOM-элементы рейтинга и внедряет их в контейнер.
	 * Автоматически удаляет старые элементы с тем же ключом (защита от дублей).
	 *
	 * @param {Object} params
	 * @param {HTMLElement} params.container - Родительский блок (.scores)
	 * @param {number|string} params.score   - Числовое значение оценки (например, 8.55)
	 * @param {string} params.key            - Уникальный ключ ('anilist', 'shiki', 'mal')
	 * @param {string} params.label          - Подпись под рейтингом (например 'AniList')
	 * @param {string} params.mode           - 'stars' (звезды) или 'headline' (текст в заголовке)
	 * @param {string} [params.subHeadlineSelector] - Селектор заголовка (нужен только для mode='headline')
	 */
	function renderRating({
		container,
		score,
		key,
		label,
		mode = "stars",
		subHeadlineSelector = ".subheadline",
	}) {
		if (!container || score == null || isNaN(score)) return;

		const numericScore = Number(score);
		const roundedScore = Math.round(numericScore);
		const scoreClass = `score-${roundedScore}`;
		const noticeText = getScoreText(numericScore);

		// 1. РЕЖИМ "STARS" (Блок со звездами)
		if (mode === "stars") {
			// Удаляем старые, если есть (очистка перед рендером)
			container.querySelector(`.${key}-average-score`)?.remove();
			container.querySelector(`.${key}-label`)?.remove();

			// Создаем обертку для звезд
			const rateDiv = document.createElement("div");
			rateDiv.className = `b-rate ${key}-average-score`;
			rateDiv.innerHTML = `
                <div class="stars-container">
                    <div class="hoverable-trigger"></div>
                    <div class="stars score ${scoreClass}"></div>
                    <div class="stars hover"></div>
                    <div class="stars background"></div>
                </div>
                <div class="text-score">
                    <div class="score-value ${scoreClass}">${numericScore}</div>
                    <div class="score-notice">${noticeText}</div>
                </div>
            `;

			// Создаем подпись
			const labelP = document.createElement("p");
			labelP.className = `score ${key}-label`;
			// Стили вынесены в JS, но лучше добавить их в CSS класс
			labelP.style.marginTop = "2px";
			labelP.style.fontSize = "12px";
			labelP.style.color = "#999";
			labelP.style.textAlign = "center";
			labelP.textContent = label;

			// Вставляем
			container.appendChild(rateDiv);
			container.appendChild(labelP);
		}

		// 2. РЕЖИМ "HEADLINE" (Текст в заголовке "Оценки людей")
		else if (mode === "headline") {
			// Ищем ближайший заголовок или глобальный
			const header =
				container
					.closest(".block")
					?.querySelector(subHeadlineSelector) ||
				document.querySelector(subHeadlineSelector); // фоллбэк

			if (header) {
				// Удаляем старый, если есть
				header.querySelector(`[data-rating-key="${key}"]`)?.remove();

				const span = document.createElement("span");
				span.dataset.ratingKey = key;
				span.style.marginLeft = "10px";
				span.style.fontSize = "14px";
				span.style.color = "#777";
				span.textContent = `| ${label}: ${numericScore}`;

				header.appendChild(span);
			}
		}
	}

	// Рендер списка комментариев в читаемую разметку.
	// Комментарии приходят от новых к старым -> разворачиваем (старые сверху, как на shikimori).
	const escapeAttr = (s) =>
		String(s == null ? "" : s)
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	const formatCommentDate = (iso) => {
		if (!iso) return "";
		try {
			return new Date(iso).toLocaleString("ru-RU", {
				day: "numeric",
				month: "long",
				year: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch (e) {
			return "";
		}
	};
	const renderCommentItem = (c) => {
		const url = escapeAttr(c.user_url || "#");
		const nick = escapeAttr(c.user || "Гость");
		const avatar = escapeAttr(c.avatar || "");
		const date = formatCommentDate(c.created_at);
		const body = c.html_body || "";
		return (
			`<div class="b-comment fix404-comment" id="comment-${escapeAttr(c.id)}" ` +
			`style="display:flex;gap:12px;padding:14px 0;border-top:1px solid rgba(128,128,128,.18);">` +
			(avatar
				? `<a href="${url}" style="flex:none;"><img src="${avatar}" width="48" height="48" loading="lazy" style="width:48px;height:48px;border-radius:4px;display:block;"></a>`
				: "") +
			`<div style="flex:1;min-width:0;">` +
			`<div style="margin-bottom:5px;"><a href="${url}" style="font-weight:bold;">${nick}</a>` +
			(date ? `<span style="opacity:.5;font-size:12px;margin-left:8px;">${date}</span>` : "") +
			`</div>` +
			`<div class="b-text_with_paragraphs" style="word-wrap:break-word;overflow-wrap:anywhere;">${body}</div>` +
			`</div></div>`
		);
	};
	const renderCommentsHTML = (comments) => {
		if (!Array.isArray(comments) || comments.length === 0) return "";
		return comments.slice().reverse().map(renderCommentItem).join("");
	};

	// НАТИВНЫЙ блок user_rate: пустой контейнер .b-user_rate.to-process с данными
	// пользователя. JS shikimori сам отрисует кнопку статуса + прогресс серий/глав
	// + виджет оценки (точь-в-точь как на сайте, со своими рабочими обработчиками).
	// Гидрация запускается нашим triggerPageLoadEvents (dispatch turbolinks:load).
	const renderUserRateNative = (data) => {
		const id = Number(data.INFO.ID);
		const isAnimeT = data.TYPE === "anime";
		const targetType = isAnimeT ? "Anime" : "Manga"; // ranobe -> Manga
		const cls = isAnimeT ? "anime" : "manga";
		const ls =
			data.LIST_STATUS && !Array.isArray(data.LIST_STATUS) && data.LIST_STATUS.id
				? data.LIST_STATUS
				: null;
		const user = data.USER;
		const entry = {
			id,
			episodes: isAnimeT ? data.INFO.EPISODES_TOTAL || null : null,
			chapters: !isAnimeT ? data.INFO.CHAPTERS_TOTAL || null : null,
			volumes: !isAnimeT ? data.INFO.VOLUMES_TOTAL || null : null,
		};
		const model = {
			id: ls ? ls.id : null,
			user_id: user ? Number(user.USER_ID) : null,
			target_id: id,
			score: ls ? ls.score || 0 : 0,
			status: ls ? ls.status : "planned",
			episodes: ls ? ls.episodes || 0 : 0,
			created_at: null,
			updated_at: null,
			target_type: targetType,
			volumes: ls ? ls.volumes || 0 : 0,
			chapters: ls ? ls.chapters || 0 : 0,
			text: null,
			rewatches: ls ? ls.rewatches || 0 : 0,
		};
		const esc = (o) => JSON.stringify(o).replace(/"/g, "&quot;");
		return `<div class="b-user_rate to-process ${cls}-${id}" data-dynamic="user_rate" data-entry="${esc(entry)}" data-extended="true" data-model="${esc(model)}" data-target_id="${id}" data-target_type="${targetType}" data-track_user_rate="user_rate:${cls}:${id}"></div>`;
	};

	// Виджеты прогресса (серии/главы) и личной оценки под кнопкой статуса.
	// КАСТОМНЫЙ ФОЛБЭК (если нативная гидрация не сработает). Основной путь — нативный.
	const renderUserRateExtras = (data) => {
		const user = data.USER;
		const ls = data.LIST_STATUS;
		if (!user || !ls || Array.isArray(ls) || !ls.id) return "";

		const isAnimeT = data.TYPE === "anime";
		const id = data.INFO.ID;
		const targetType = isAnimeT ? "Anime" : "Manga"; // ranobe -> Manga для API
		const total = isAnimeT
			? data.INFO.EPISODES_TOTAL || 0
			: data.INFO.CHAPTERS_TOTAL || 0;
		const watched = isAnimeT ? ls.episodes || 0 : ls.chapters || 0;
		const field = isAnimeT ? "episodes" : "chapters";
		const label = isAnimeT ? "Эпизоды" : "Главы";
		const score = ls.score || 0;

		const progress = `
			<div class="fix404-ur-progress" style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;">
				<span style="opacity:.65;">${label}</span>
				<span class="fix404-ur-btn" data-act="dec" style="cursor:pointer;user-select:none;padding:0 7px;opacity:.7;font-weight:bold;">−</span>
				<b class="fix404-ur-watched">${watched}</b>
				<span style="opacity:.5;">/ ${total || "?"}</span>
				<span class="fix404-ur-btn" data-act="inc" style="cursor:pointer;user-select:none;padding:0 7px;opacity:.7;font-weight:bold;">+</span>
			</div>`;

		let stars = "";
		for (let i = 1; i <= 10; i++) {
			stars += `<span class="fix404-ur-star" data-val="${i}" style="cursor:pointer;font-size:17px;line-height:1;color:${
				i <= score ? "#f0b400" : "rgba(140,140,140,.45)"
			};">★</span>`;
		}
		const scoreBlock = `
			<div class="fix404-ur-score" style="display:flex;align-items:center;gap:8px;margin-top:6px;">
				<span class="fix404-ur-stars" style="letter-spacing:-1px;white-space:nowrap;">${stars}</span>
				<b class="fix404-ur-score-num" style="font-size:15px;">${score || ""}</b>
				<span class="fix404-ur-score-label" style="opacity:.65;font-size:12px;">${score ? getScoreText(score) : ""}</span>
			</div>`;

		return `<div class="fix404-userrate-extras" data-rate-id="${ls.id}" data-target-id="${id}" data-target-type="${targetType}" data-field="${field}" data-total="${total}">${progress}${scoreBlock}</div>`;
	};

	const renderTemplate = (html, data) => {
		const content_type = data.TYPE; // 'anime' or 'manga' or 'ranobe'
		// ^ {{CONTENT_TYPE}}
		debug(`Data type right now is: ${content_type}`);
		debug(`Another data type right now is: ${data.INFO.TYPE}`);
		const isAnime = content_type === "anime";
		const isRanobe = content_type === "ranobe";
		const sectionName = isAnime ? "Аниме" : (isRanobe ? "Ранобэ" : "Манга");

		// Вставка пользовательского CSS, если он есть
		if (data.USER_CSS) {
			html = html.replace(
				'<style id="custom_css" type="text/css"></style>',
				`<style id="custom_css" type="text/css">${data.USER_CSS}</style>`,
			);
		}

		// Формат: https://example.com
		html = html.replaceAll("{{SITE_NAME}}", CONFIG.SITE_NAME || "");
		// Формат: example.com
		html = html.replaceAll("{{DOMAIN_NAME}}", CONFIG.DOMAIN_NAME || "");

		// Замены основных плейсхолдеров
		html = html.replaceAll("{{ID}}", data.INFO.ID || "");
		html = html.replaceAll("{{RU_NAME}}", data.INFO.RU_NAME || "N/A");
		html = html.replaceAll("{{EN_NAME}}", data.INFO.EN_NAME || "N/A");
		// Локализуем тип (kind): manga -> Манга, novel -> Ранобэ, tv -> TV Сериал и т.д.
		const KIND_RU = {
			tv: "TV Сериал", movie: "Фильм", ova: "OVA", ona: "ONA",
			special: "Спецвыпуск", tv_special: "TV Спецвыпуск", music: "Клип",
			pv: "PV", cm: "CM", manga: "Манга", manhwa: "Манхва", manhua: "Маньхуа",
			novel: "Ранобэ", one_shot: "Ваншот", doujin: "Додзинси",
		};
		html = html.replaceAll("{{TYPE}}", KIND_RU[data.INFO.TYPE] || data.INFO.TYPE || "?");
		// Существительное в родительном падеже для "У аниме/манги/ранобэ".
		html = html.replaceAll(
			"{{ENTITY_NOUN}}",
			isAnime ? "аниме" : isRanobe ? "ранобэ" : "манги",
		);
		html = html.replaceAll("{{CONTENT_TYPE}}", content_type || "?"); // anime / manga
		html = html.replaceAll("{{CONTENT_TYPE_UP}}", data.TYPE_UP || "?"); // Anime / Manga
		html = html.replaceAll("{{CONTENT_TYPE_M}}", data.TYPE_M || "?"); // animes /
		html = html.replaceAll("{{SECTION_NAME}}", sectionName || "?");
		html = html.replaceAll("{{STATUS}}", data.INFO.STATUS || "N/A");
		html = html.replaceAll("{{STATUS_CLASS}}", data.INFO.STATUS_CLASS || "other");
		html = html.replaceAll("{{DATE_RANGE}}", data.INFO.DATE_RANGE || "");
		html = html.replaceAll("{{DATE_TOOLTIP}}", data.INFO.DATE_TOOLTIP || "");
		html = html.replaceAll("{{SCORE}}", data.INFO.SCORE || "N/A");

		// Блок количества: аниме -> "Эпизоды: N"; манга/ранобэ -> отдельные строки
		// "Тома: V" и "Главы: C" (как на оригинале), а не "Тома/Главы: V / C".
		const lineRow = (k, v) =>
			`<div class='line-container'> <div class='line'> <div class='key'>${k}:</div> <div class='value'>${v}</div> </div> </div>`;
		const countBlock = isAnime
			? lineRow("Эпизоды", data.INFO.EPISODES_TOTAL || "?")
			: lineRow("Тома", data.INFO.VOLUMES_TOTAL || "?") +
				lineRow("Главы", data.INFO.CHAPTERS_TOTAL || "?");
		html = html.replaceAll("{{COUNT_BLOCK}}", countBlock);
		// Старые плейсхолдеры на случай, если где-то ещё используются.
		html = html.replaceAll("{{COUNT_LABEL}}", data.INFO.COUNT_LABEL);
		html = html.replaceAll("{{COUNT_VALUE}}", data.INFO.COUNT_VALUE);

		// Длительность — только у аниме. Для манги DURATION_BLOCK="" (без "? мин.").
		html = html.replaceAll(
			"{{DURATION_BLOCK}}",
			data.INFO.DURATION_BLOCK || "",
		);

		html = html.replaceAll("{{SOURCE}}", data.INFO.SOURCE || "Отсутствует");
		html = html.replaceAll("{{POSTER}}", getFullUrl(data.POSTER) || "");
		html = html.replaceAll(
			"{{DESCRIPTION}}",
			data.INFO.DESCRIPTION || "Описание отсутствует",
		);
		html = html.replaceAll(
			"{{MYANIMELIST_ID}}",
			data.INFO.MYANIMELIST_ID || "",
		);
		const renderedComments = Array.isArray(data.COMMENTS) ? data.COMMENTS : [];
		const renderedCount = renderedComments.length;
		const commentsTotal = Number.isFinite(data.INFO.COMMENTS_TOTAL)
			? data.INFO.COMMENTS_TOTAL
			: renderedCount;

		// "КОММЕНТАРИИ N", "Скрыть/Показать N" — реальное общее число.
		html = html.replaceAll("{{COMMENTS_COUNT}}", commentsTotal);
		html = html.replaceAll("{{COMMENTS_TOTAL}}", commentsTotal);
		html = html.replaceAll("{{COMMENTS_RENDERED}}", renderedCount);
		// Догрузка ведёт собственную пагинацию по 10 (limit=10) с дедупом по DOM -> старт с 1.
		html = html.replaceAll("{{COMMENTS_NEXT_PAGE}}", 1);
		// Сколько предложить догрузить в тексте кнопки.
		html = html.replaceAll(
			"{{COMMENTS_LOAD_STEP}}",
			Math.min(COMMENTS_LOAD_STEP, Math.max(0, commentsTotal - renderedCount)),
		);
		html = html.replaceAll("{{TOPIC_ID}}", data.INFO.TOPIC_ID || "");

		// Нечего догружать (комментов нет или все уже показаны) -> убираем кнопку.
		if (commentsTotal <= renderedCount) {
			html = html.replace(/<div class="fix404-load-more[\s\S]*?<\/div>/, "");
		}
		html = html.replaceAll(
			"{{AUTHENTICITY_TOKEN}}",
			data.ASSETS.CSRF_TOKEN || "",
		);
		html = html.replace("{{FETCHED_CSS}}", data.ASSETS.FETCHED_CSS || "");
		html = html.replace("{{FETCHED_JS}}", data.ASSETS.FETCHED_JS || "");

		if (data.USER) {
			html = html.replaceAll("{{USER_ID}}", data.USER?.USER_ID || "");
			html = html.replaceAll("{{USER_NICK}}", data.USER?.USER_NICK || "");
			html = html.replaceAll(
				"{{USER_URL}}",
				getFullUrl(data.USER.USER_URL),
			);
			html = html.replaceAll(
				"{{USER_AVATAR}}",
				getFullUrl(data.USER.USER_AVATAR),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X16}}",
				getFullUrl(data.USER.USER_AVATAR_X16),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X32}}",
				getFullUrl(data.USER.USER_AVATAR_X32),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X48}}",
				getFullUrl(data.USER.USER_AVATAR_X48),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X64}}",
				getFullUrl(data.USER.USER_AVATAR_X64),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X80}}",
				getFullUrl(data.USER.USER_AVATAR_X80),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X148}}",
				getFullUrl(data.USER.USER_AVATAR_X148),
			);
			html = html.replaceAll(
				"{{USER_AVATAR_X160}}",
				getFullUrl(data.USER.USER_AVATAR_X160),
			);
		}

		html = html.replaceAll(
			"{{RELATED_CONTENT}}",
			renderRelatedBlock(data.RELATED, data.USER),
		);

		function renderSimilarAnimes(animes) {
			if (!Array.isArray(animes) || animes.length === 0) return "";
			return animes
				.slice(0, CONFIG.SIMILAR_LIMIT)
				.map((anime) => {
					const id = anime.id;
					const kind =
						anime.kind === "tv" ? "anime" : anime.kind || "anime";
					const url = `/animes/${id}`;
					const nameEn = anime.name || "";
					const nameRu = anime.russian || nameEn;
					const airedOn = anime.aired_on?.split("-")?.[0] || "";

					// ВЫБИРАЕМ ОПТИМАЛЬНОЕ ИЗОБРАЖЕНИЕ:
					// x96 или preview - идеальны для превью. Original - слишком большой и медленный.
					const imagePath =
						anime.image?.x96 ||
						anime.image?.preview ||
						anime.image?.original ||
						"";

					if (!imagePath) {
						return ""; // Пропускаем аниме без изображения
					}

					// const imageUrl = `https://shikimori.one${imagePath}`;
					const imageUrl = getFullUrl(imagePath);

					const imageHtml = `
                  <picture style="display: block; width: 93px; height: 132px;">
                      <source srcset="${imageUrl} 1x, ${imageUrl} 2x" type="image/jpeg">
                      <img alt="${nameRu}"
                          src="${imageUrl}"
                          srcset="${imageUrl} 2x"
                          style="width: 93px; height: 132px; object-fit: cover; display: block;">
                  </picture>
              `;

					return `
                <article class="c-column b-catalog_entry c-${kind} entry-${id}"
                        data-track_user_rate="catalog_entry:${kind}:${id}"
                        id="${id}"
                        itemscope
                        itemtype="http://schema.org/Movie"
                        style="width: 93px; height: auto; float: left; margin: 5px; overflow: hidden;">
                  <a class="cover bubbled"
                    data-delay="150"
                    data-tooltip_url="/animes/${id}/tooltip"
                    href="${url}"
                    style="display: block; width: 93px; text-decoration: none;">
                    <span class="image-decor" style="display: block; width: 93px; height: 132px; overflow: hidden;">
                      <span class="image-cutter" style="display: block; width: 93px; height: 132px;">
                        ${imageHtml}
                      </span>
                    </span>
                    <span class="title two_lined" itemprop="name" style="display: block; width: 93px; font-size: 12px; line-height: 1.2; margin-top: 5px; word-wrap: break-word;">
                      <span class="name-en" style="display: block; font-weight: bold;">${nameEn}</span>
                      <span class="name-ru" style="display: block; color: #666;">${nameRu}</span>
                    </span>
                    <span class="misc" style="display: block; width: 93px; font-size: 11px; color: #999;">${airedOn}</span>
                  </a>
                  <meta content="${
						anime.image?.original || ""
					}" itemprop="image">
                  <meta content="${
						anime.image?.x48 || ""
					}" itemprop="thumbnailUrl">
                  <meta content="${airedOn}" itemprop="dateCreated">
                </article>`.trim();
				})
				.join("");
		}

		function renderSimilarAnimesBlock(animes) {
			const limited = animes.slice(0, 7);
			const entries = renderSimilarAnimes(limited);
			return entries ? `<div class="cc cc-similar">${entries}</div>` : "";
		}
		// === Похожие аниме ===
		if (data.SIMILAR_ANIMES && Array.isArray(data.SIMILAR_ANIMES)) {
			html = html.replace(
				"{{SIMILAR_ANIMES}}",
				renderSimilarAnimesBlock(data.SIMILAR_ANIMES),
			);
		} else {
			html = html.replace("{{SIMILAR_ANIMES}}", "");
		}

		/**
		 * @description Рендерит HTML-блок для персонажей.
		 * @param {Array} charactersList - Массив персонажей.
		 * @param {Boolean} isMain - Флаг: true для главных (показать всех), false для второстепенных (скрывать под спойлер).
		 * @returns {string} Готовый HTML-блок.
		 */
		const renderCharacters = (charactersList, isMain = true) => {
			if (!Array.isArray(charactersList) || charactersList.length === 0) {
				// Если главных героев нет, выводим заглушку. Если нет второстепенных — просто пустоту.
				if (isMain) {
					return '<div class="cc m0" style="text-align: center; padding: 20px; color: #666; font-style: italic;">Нет информации о главных героях.</div>';
				}
				return "";
			}

			const itemsHtml = charactersList.map((role) => {
				const char = role.character;
				if (!char) return "";

				const url = getFullUrl(char.url);
				const imagePreview = char.image?.preview
					? getFullUrl(char.image.preview)
					: "/assets/globals/missing_preview.jpg";
				const imageX96 = char.image?.x96
					? getFullUrl(char.image.x96)
					: imagePreview;

				return `
				<article class="c-column b-catalog_entry c-character entry-${
					char.id
				}" id="${char.id}" itemscope itemtype="http://schema.org/Person">
					<meta content="${char.image.original}" itemprop="image">
					<meta content="${char.image.x48}" itemprop="thumbnailUrl">
					<a class="cover bubbled" data-delay="150" data-tooltip_url="/characters/${
						char.id
					}/tooltip" href="${url}">
						<span class="image-decor">
							<span class="image-cutter">
								<picture>
									<source srcset="${imagePreview}, ${imageX96} 2x" type="image/webp">
									<img alt="${
										char.russian || char.name
									}" src="${imagePreview}" srcset="${imageX96} 2x">
								</picture>
							</span>
						</span>
						<span class="title two_lined" itemprop="name">
							<span class="name-en">${char.name}</span>
							<span class="name-ru">${char.russian || char.name}</span>
						</span>
					</a>
				</article>
				`;
			});

			let contentHtml = "";

			if (isMain) {
				// Главные герои: показываем всех
				contentHtml = itemsHtml.join("");
			} else {
				// Второстепенные: прячем под спойлер (лимит 7)
				contentHtml = renderExpandable(itemsHtml, 7, "показать всех");
			}

			const gridHtml = `<div class="cc m0">${contentHtml}</div>`;

			if (isMain) {
				return gridHtml;
			} else {
				// Для второстепенных добавляем обертку и заголовок, так как они находятся вне основного блока в шаблоне
				return `
                    <div class="c-characters m0">
                        <div class="subheadline">Второстепенные герои</div>
                        ${gridHtml}
                    </div>
                `;
			}
		};

		html = html.replaceAll(
			"{{MAIN_CHARACTERS}}",
			renderCharacters(data.ROLES.main, true),
		);

		html = html.replaceAll(
			"{{SUPPORTING_CHARACTERS}}",
			renderCharacters(data.ROLES.supporting, false),
		);

		function renderStaffBlock(staff) {
			if (!Array.isArray(staff) || staff.length === 0) {
				return '<div class="cc" style="text-align:center;padding:20px;color:#666;font-style:italic;">Нет информации о команде.</div>';
			}

			// 1) Таблица важности ролей (ближе к Shikimori)
			const ROLE_PRIORITY = {
				"Original Creator": 1,
				Story: 1,
				Script: 1,

				Director: 2,
				"Series Composition": 2,
				"Episode Director": 3,
				Storyboard: 3,

				"Chief Animation Director": 4,
				"Animation Director": 5,
				"Character Design": 5,

				"Chief Producer": 6,
				Producer: 7,

				"Key Animation": 8,
				"2nd Key Animation": 9,
				"In-Between Animation": 10,
			};

			// 2) Функция определения важности человека
			function getPersonPriority(role) {
				return Math.min(
					...role.roles.map((r) => ROLE_PRIORITY[r] || 999),
				);
			}

			// 3) Сортировка staff по важности
			const sortedStaff = staff
				.slice() // копия массива
				.sort((a, b) => getPersonPriority(a) - getPersonPriority(b))
				.slice(0, 5); // максимум 5 человек

			// 4) Рендер
			return `
          <div class="cc">
              ${sortedStaff
					.map((role) => {
						const p = role.person;
						const id = p.id;
						// const url = `https://shikimori.one${p.url}`;
						const url = getFullUrl(p.url);

						const imgPreview = p.image?.preview
							? `${p.image.preview}`
							: "/assets/globals/missing/mini.png";

						const img2x = p.image?.x96
							? getFullUrl(p.image.x96)
							: img4x;

						const img4x = p.image?.x48
							? getFullUrl(p.image.x48)
							: "/assets/globals/missing/mini@4x.png";

						const roleTags = role.roles
							.map((r) => `<div class="b-tag">${r}</div>`)
							.join("");

						return `
                      <div class="b-db_entry-variant-list_item"
                          data-id="${id}" data-text="${p.russian || p.name}"
                          data-type="person" data-url="${url}">
                          <a class="image bubbled" href="${url}">
                              <picture>
                                  <img src="${img4x}" srcset="${img2x} 2x" alt="${
										p.russian || p.name
									}">
                              </picture>
                          </a>
                          <div class="info">
                              <div class="name">
                                  <a class="b-link bubbled" href="${url}">
                                      <span class="name-en">${p.name}</span>
                                      <span class="name-ru">${
											p.russian || p.name
										}</span>
                                  </a>
                              </div>
                              <div class="line multiline">
                                  <div class="key">${
										role.roles.length > 1
											? "Роли:"
											: "Роль:"
									}</div>
                                  <div class="value">${roleTags}</div>
                              </div>
                          </div>
                      </div>
                  `;
					})
					.join("")}
          </div>
        `;
		}
		html = html.replace("{{STAFF}}", renderStaffBlock(data.ROLES.staff));

		// data.SCREENSHOTS и data.VIDEOS.LIST приходят из getEntityData
		const mediaBlockHtml = renderScreenshotsAndVideos(
			data.SCREENSHOTS,
			data.VIDEOS.LIST,
		);
		html = html.replaceAll(
			"{{SCREENSHOTS_AND_VIDEOS}}",
			mediaBlockHtml || "",
		);

		function getRatingTooltip(rating) {
			if (!rating) return "";
			switch (rating) {
				case "g":
					return "G - Для всех возрастов";
				case "pg":
					return "PG - Родителям рекомендуется просмотреть перед детьми";
				case "pg_13":
					return "PG-13 - Детям до 13 лет просмотр не желателен";
				case "r":
					return "R - Лицам до 17 лет обязательно присутствие взрослого";
				case "r+":
					return "R+ - Лицам до 17 лет просмотр запрещён";
				case "rx":
					return "Хентай - смотреть только с родителями";
				default:
					return rating;
			}
		}
		html = html.replaceAll("{{RATING}}", data.INFO.RATING || "");

		const score = parseFloat(data.INFO.SCORE || 0);
		const scoreRound = Math.round(score);
		html = html.replaceAll("{{SCORE}}", score.toFixed(2));
		html = html.replaceAll("{{SCORE_ROUND}}", scoreRound);
		html = html.replaceAll("{{RATING_NOTICE}}", getScoreText(score));
		html = html.replaceAll(
			"{{RATING_TOOLTIP}}",
			getRatingTooltip(data.INFO.RATING),
		);

		html = html.replaceAll("{{ORG_LABEL}}", data.INFO.ORG_LABEL);

		const orgs = data.INFO.ORGANIZATIONS || [];
		const orgsHtml = orgs
			.map(
				(org) =>
					`<a href="/${data.TYPE}s/${
						data.TYPE === "anime" ? "studio" : "publisher"
					}/${org.id}-${encodeURIComponent(org.name)}"
              title="${org.name}">
              ${
					org.imageUrl
						? `<img src="${org.imageUrl}" class="studio-logo">`
						: `<span class="b-tag">${org.name}</span>`
				}
           </a>`,
			)
			.join(" ");
		html = html.replaceAll("{{ORGANIZATIONS}}", orgsHtml);

		function renderGenres(genres) {
			if (!Array.isArray(genres) || genres.length === 0) return "";
			return (
				`<div class='key'>Жанры:</div><div class='value'>` +
				genres
					.map((g) => {
						const en = g.name || "";
						const ru = g.russian || en;
						const id = g.id || "";
						const href = `/animes/genre/${id}-${en}`;
						return `<a class="b-tag bubbled" href="${href}"><span class='genre-en'>${en}</span><span class='genre-ru'>${ru}</span></a>`;
					})
					.join("\n") +
				`</div>`
			);
		}
		html = html.replaceAll("{{GENRES}}", renderGenres(data.INFO.GENRES));

		function renderUserRatingsHTML(userScores) {
			if (!Array.isArray(userScores) || userScores.length === 0)
				return "";
			const statsArray = userScores.map((item) => [
				String(item.score),
				item.count,
			]);
			const dataStats = JSON.stringify(statsArray).replace(
				/"/g,
				"&quot;",
			);
			return `<div class="block"><div class="subheadline">Оценки людей</div><div data-bar="horizontal" data-stats="${dataStats}" id="rates_scores_stats"></div></div>`;
		}
		html = html.replaceAll(
			"{{USER_RATINGS}}",
			renderUserRatingsHTML(data.RATINGS.USER_SCORES),
		);

		function renderUserStatusesHTML(userStatuses) {
			if (!Array.isArray(userStatuses) || userStatuses.length === 0)
				return "";
			const statusNames = {
				planned: "Запланировано",
				watching: "Смотрю",
				completed: "Просмотрено",
				dropped: "Брошено",
				on_hold: "Отложено",
			};
			const statusMap = {
				Запланировано: "planned",
				Смотрю: "watching",
				Просмотрено: "completed",
				Брошено: "dropped",
				Отложено: "on_hold",
			};
			const statsArray = userStatuses.map((item) => [
				statusMap[item.status] || item.status.toLowerCase(),
				item.count,
			]);
			const total = userStatuses.reduce(
				(sum, item) => sum + item.count,
				0,
			);
			return `<div class="block"><div class="subheadline">В списках у людей</div><div data-bar="horizontal" data-entry_type="anime" data-stats="${JSON.stringify(
				statsArray,
			).replace(
				/"/g,
				"&quot;",
			)}" id="rates_statuses_stats"></div><div class="total-rates">В списках у ${total} человек</div></div>`;
		}
		html = html.replaceAll(
			"{{USER_STATUSES}}",
			renderUserStatusesHTML(data.RATINGS.USER_STATUS_STATS),
		);

		const userRateButtonHtml = renderUserRateButton(
			data.INFO.ID,
			isAnime ? "Anime" : (isRanobe ? "Ranobe" : "Manga"),
			data.USER?.USER_ID || null,
			data.LIST_STATUS
		);
		// Основной путь — нативный контейнер (shikimori сам отрисует кнопку+прогресс+оценку).
		// userRateButtonHtml остаётся доступным как кастомный фолбэк (см. renderEntityPage).
		html = html.replaceAll("{{USER_RATE_BUTTON}}", renderUserRateNative(data));
		html = html.replaceAll("{{USER_RATE_EXTRA}}", "");


		function renderDubbing(dubbing) {
			if (!Array.isArray(dubbing) || dubbing.length === 0) return "";
			const visible = dubbing
				.slice(0, 5)
				.map(
					(d) =>
						`<div class="b-menu-line" title="${d.name}">${d.name}</div>`,
				)
				.join("\n");
			const hidden = dubbing
				.slice(5)
				.map(
					(d) =>
						`<div class="b-menu-line" title="${d.name}">${d.name}</div>`,
				)
				.join("\n");
			if (!hidden) return visible;
			return `${visible}<div class="b-show_more unprocessed">+ показать всех</div><div class="b-show_more-more" style="display:none;">${hidden}<div class="hide-more">&mdash; спрятать</div></div>`;
		}
		html = html.replaceAll(
			"{{DUBBING}}",
			renderDubbing(data.VIDEOS.DUBBING),
		);

		function renderSubtitles(subtitles) {
			if (!Array.isArray(subtitles) || subtitles.length === 0) return "";
			return subtitles
				.map(
					(s) =>
						`<div class="b-menu-line" title="${s.name}">${s.name}</div>`,
				)
				.join("\n");
		}
		html = html.replaceAll(
			"{{SUBTITLES}}",
			renderSubtitles(data.VIDEOS.SUBTITLES),
		);

		function renderNewsHTML(newsArray) {
			if (!Array.isArray(newsArray) || newsArray.length === 0) {
				log("Массив новостей пуст!");
				debug("News array: ", newsArray);
				return "";
			}
			return `<div class="b-menu-links menu-topics-block history m30"><div class="subheadline m5">Новости</div><div class="block">${newsArray
				.map(
					(n) =>
						`<a class="b-menu-line entry b-link" href="${n.link}" style="display:block; margin:4px 0;"><span class="name">${n.topic_title}</span></a>`,
				)
				.join("\n")}</div></div>`;
		}
		html = html.replaceAll("{{NEWS}}", renderNewsHTML(data.NEWS));

		html = html.replaceAll(
			"{{COMMENTS}}",
			renderCommentsHTML(Array.isArray(data.COMMENTS) ? data.COMMENTS : []),
		);

		function renderExternalLinks(links) {
			if (!Array.isArray(links) || links.length === 0) return "";
			return links
				.map((l) => {
					const url = l.url || "#";
					const siteName = l.site || "Unknown";
					// Use the raw kind for the class. If it's missing, default to 'unknown'
					const siteClass = l.kind || "unknown";

					return `<div class="b-external_link ${siteClass} b-menu-line"><div class="linkeable b-link" data-href="${url}">${siteName}</div></div>`;
				})
				.join("\n");
		}
		html = html.replaceAll(
			"{{EXTERNAL_LINKS}}",
			renderExternalLinks(data.EXTERNAL_LINKS),
		);

		// Инициализация JS_EXPORT (пустая строка, так как executeShikimoriScripts не используется)
		html = html.replace("{{JS_EXPORT}}", "");

		return html;
	};

	// === ---------------- ===
	// === Финальная логика ===
	// === ---------------- ===

	// === Поддержка кнопки "Ответить" ===
	const setupReplyButtons = () => {
		const textarea = document.querySelector(
			'textarea[name="comment[body]"]',
		);
		if (!textarea) {
			log("Редактор не найден — кнопка Ответить не будет работать");
			return false;
		}

		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".item-reply");
			if (!btn) return;

			const comment = btn.closest(".b-comment");
			if (!comment) return;

			const commentId =
				comment.id.replace("comment-", "") ||
				comment.dataset.track_comment;
			const userId = comment.dataset.user_id;
			const nickname =
				comment.dataset.user_nickname ||
				comment.querySelector(".name a")?.textContent.trim() ||
				"анон";

			if (!commentId || !userId) return;

			e.preventDefault();

			const tag = `[comment=${commentId};${userId}], `;
			const val = textarea.value;
			const insert = val && !val.endsWith("\n") ? "\n" + tag : tag;

			textarea.value = val + insert;
			textarea.focus();
			textarea.setSelectionRange(
				textarea.value.length,
				textarea.value.length,
			);
			textarea.scrollIntoView({ behavior: "smooth", block: "center" });

			// Кнопка "назад"
			const back = document.querySelector(".return-to-reply");
			if (back) {
				back.style.visibility = "visible";
				back.textContent = `к @${nickname}`;
				back.onclick = () => {
					comment.scrollIntoView({
						behavior: "smooth",
						block: "center",
					});
				};
			}

			// Визуальный отклик
			btn.style.opacity = "0.5";
			setTimeout(() => (btn.style.opacity = ""), 200);
		});

		log("Кнопка «Ответить» активирована");
		return true;
	};

	// === Поддержка кнопки "Цитировать" ===
	const setupQuoteButtons = () => {
		const textarea = document.querySelector(
			'textarea[name="comment[body]"]',
		);
		if (!textarea) {
			log("Редактор не найден — кнопка Цитировать не будет работать");
			return false;
		}

		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".item-quote");
			if (!btn) return;

			const comment = btn.closest(".b-comment");
			if (!comment) return;

			const commentId = comment.id || comment.dataset.track_comment;
			const userId = comment.dataset.user_id;
			const nickname =
				comment.dataset.user_nickname ||
				comment.querySelector(".name a")?.textContent.trim() ||
				"анон";

			e.preventDefault();

			// Пытаемся получить выделенный текст
			let selectedText = "";
			const selection = window.getSelection();

			// Проверяем, есть ли выделение внутри текущего комментария
			if (selection.rangeCount > 0 && selection.toString().trim()) {
				const range = selection.getRangeAt(0);
				const selectedNode = range.commonAncestorContainer;

				// Проверяем, находится ли выделение внутри этого комментария
				if (comment.contains(selectedNode)) {
					selectedText = selection.toString().trim();
				}
			}

			let quoteText;

			if (selectedText) {
				// Если есть выделенный текст - используем его
				quoteText = selectedText;
				log(
					`Цитируется выделенный текст: ${quoteText.substring(
						0,
						100,
					)}...`,
				);
			} else {
				// Если нет выделения - берем весь текст комментария
				const commentBody = comment.querySelector(".body");
				if (!commentBody) return;

				const commentText =
					commentBody.textContent || commentBody.innerText;
				const maxLength = 50000;
				quoteText =
					commentText.length > maxLength
						? commentText.substring(0, maxLength) + "..."
						: commentText;

				log(`Выделения нет, цитируется весь комментарий`);
			}

			// Очищаем текст для форматирования
			const cleanText = quoteText
				.replace(/\n\s*\n/g, "\n\n")
				.replace(/[ \t]+/g, " ")
				.trim();

			if (!cleanText) {
				log("Нет текста для цитирования");
				return;
			}

			// Формируем тег цитаты
			const quoteTag = `[quote=${commentId.replace(
				"comment-",
				"",
			)};${userId};${nickname}]${cleanText}[/quote]\n\n`;

			// Вставляем в текстовое поле
			const val = textarea.value;
			const insert =
				val && !val.endsWith("\n") ? "\n" + quoteTag : quoteTag;

			textarea.value = val + insert;
			textarea.focus();
			textarea.setSelectionRange(
				textarea.value.length,
				textarea.value.length,
			);
			textarea.scrollIntoView({ behavior: "smooth", block: "center" });

			// Снимаем выделение после цитирования
			if (selection.rangeCount > 0) {
				selection.removeAllRanges();
			}

			// Визуальный отклик
			btn.style.opacity = "0.5";
			setTimeout(() => (btn.style.opacity = ""), 200);

			log(
				`Цитата добавлена: комментарий ${commentId}, пользователь ${nickname}`,
			);
		});

		// Также добавляем обработку для мобильной версии
		document.addEventListener("click", (e) => {
			const btn = e.target.closest(".item-quote-mobile");
			if (!btn) return;

			// Находим соответствующую обычную кнопку
			const comment = btn.closest(".b-comment");
			const mainBtn = comment?.querySelector(".item-quote");

			if (mainBtn) {
				mainBtn.click();
			}
		});

		log("Кнопка «Цитировать» активирована (с поддержкой выделения текста)");
		return true;
	};


	// Догрузка комментариев по клику на нашу кнопку ".fix404-load-more".
	// Тянет следующую страницу /api/comments, дедуплицирует по уже показанным id и
	// вставляет более старые комменты сверху (хронологический порядок).
	const setupCommentsLoadMore = () => {
		document.body.addEventListener("click", async (e) => {
			const btn =
				e.target.closest && e.target.closest(".fix404-load-more");
			if (!btn || btn.dataset.loading === "1") return;
			const topic = btn.dataset.topic;
			const total = Number(btn.dataset.total) || 0;
			let page = Number(btn.dataset.nextpage) || 1;
			const list = document.querySelector(".fix404-comments-list");
			if (!topic || !list) return;

			btn.dataset.loading = "1";
			let origText = btn.textContent;
			btn.textContent = "Загрузка…";
			try {
				const seen = new Set(
					Array.from(list.querySelectorAll(".fix404-comment")).map((el) =>
						Number(el.id.replace("comment-", "")),
					),
				);
				const fresh = [];
				// Тянем порциями по COMMENTS_LOAD_STEP, пока не наберём новые
				// (страницы перекрываются на 1 -> дедуп по уже показанным).
				for (let tries = 0; tries < 3 && fresh.length === 0; tries++, page++) {
					const batch = await apiRequest(
						`/comments?commentable_id=${topic}&commentable_type=Topic&page=${page}&limit=${COMMENTS_LOAD_STEP}&order=created_at&order_direction=desc`,
					);
					if (!Array.isArray(batch) || batch.length === 0) break;
					for (const c of batch) {
						if (c && !seen.has(c.id)) {
							seen.add(c.id);
							fresh.push(c);
						}
					}
				}
				btn.dataset.nextpage = String(page);

				if (fresh.length) {
					const mapped = fresh.map((c) => ({
						id: c.id,
						html_body: c.html_body || c.body || "",
						user: c.user ? c.user.nickname : "Гость",
						user_url: c.user ? c.user.url : "#",
						avatar:
							c.user && c.user.image
								? c.user.image.x48
								: c.user
									? c.user.avatar
									: "",
						created_at: c.created_at,
					}));
					// fresh: новые->старые, и они СТАРШЕ показанных -> блок целиком сверху,
					// внутри блока — старые сверху.
					list.insertAdjacentHTML(
						"afterbegin",
						mapped.slice().reverse().map(renderCommentItem).join(""),
					);
				}

				const shown = list.querySelectorAll(".fix404-comment").length;
				const remaining = total - shown;
				if (!fresh.length || remaining <= 0) {
					btn.style.display = "none";
				} else {
					// Обновляем текст под остаток.
					btn.textContent = `Загрузить ещё ${Math.min(
						COMMENTS_LOAD_STEP,
						remaining,
					)} комментариев из ${total}`;
					origText = btn.textContent; // чтобы finally не вернул "Загрузка…"
				}
			} catch (err) {
				error("Догрузка комментариев не удалась:", err.message);
			} finally {
				btn.dataset.loading = "0";
				if (btn.textContent === "Загрузка…") btn.textContent = origText;
			}
		});
		log("Обработчик догрузки комментариев активирован");
	};

	const setupShowMoreHandlers = () => {
		document.body.addEventListener("click", (e) => {
			// Клик по "+ показать всех"
			if (e.target.matches(".b-show_more")) {
				const showBtn = e.target;
				// Ищем общий контейнер
				const wrapper = showBtn.closest(".expandable-wrapper");
				if (!wrapper) return; // Защита, если используется старая верстка где-то

				const hiddenContent = wrapper.querySelector(
					".b-show_more-content",
				);
				const hideBtn = wrapper.querySelector(".hide-more");

				if (hiddenContent) {
					showBtn.style.display = "none"; // Скрываем кнопку "+"
					hiddenContent.style.display = "inline"; // Показываем контент (inline чтобы не ломать сетку)
					if (hideBtn) hideBtn.style.display = "block"; // Показываем кнопку "-"
				}
			}

			// Клик по "— спрятать"
			if (e.target.matches(".hide-more")) {
				const hideBtn = e.target;
				const wrapper = hideBtn.closest(".expandable-wrapper");
				if (!wrapper) return;

				const hiddenContent = wrapper.querySelector(
					".b-show_more-content",
				);
				const showBtn = wrapper.querySelector(".b-show_more");

				if (hiddenContent) {
					hiddenContent.style.display = "none"; // Скрываем контент
					hideBtn.style.display = "none"; // Скрываем кнопку "-"
					if (showBtn) showBtn.style.display = "block"; // Возвращаем кнопку "+"
				}
			}
		});

		log("Обработчики Show More активированы (версия 2.0)");
	};

	// Кнопка избранного
	async function setupFavoriteButton() {
		// Вспомогательные функции для работы с избранным
		const toggleFavorite = async (type, id, isAdding) => {
			const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
			if (!csrfToken) return false;
			try {
				const response = await fetchWithTimeout(`/api/favorites/${type}/${id}`, {
					method: isAdding ? "POST" : "DELETE",
					headers: {
						"X-CSRF-Token": csrfToken,
						"X-Requested-With": "XMLHttpRequest",
						Accept: "application/json",
					},
					credentials: "include",
				});
				return response.ok;
			} catch {
				return false;
			}
		};

		const JSON_HEADERS = {
			"X-Requested-With": "XMLHttpRequest",
			Accept: "application/json",
		};

		const FAVORITE_TEXT = {
			add: "Добавить в избранное",
			remove: "Удалить из избранного",
		};

		const fetchJSON = async (url) => {
			const response = await fetchWithTimeout(url, {
				method: "GET",
				headers: JSON_HEADERS,
				credentials: "include",
			});

			if (!response.ok) {
				throw new Error(`Request failed: ${url}`);
			}

			return response.json();
		};

		const setButtonState = (button, isFavorite) => {
			const action = isFavorite ? "remove" : "add";

			button.classList.toggle("fav-add", !isFavorite);
			button.classList.toggle("fav-remove", isFavorite);

			button.setAttribute("title", FAVORITE_TEXT[action]);
			button.setAttribute("original-title", FAVORITE_TEXT[action]);

			if (button.hasAttribute("data-text")) {
				button.setAttribute("data-text", FAVORITE_TEXT[action]);
			}
		};

		const resolveFavoritesKey = (type, kind) => {
			if (type === "Person") {
				switch (kind) {
					case "Mangaka":
						return "mangakas";
					case "Seyu":
						return "seyu";
					case "Producer":
						return "producers";
					default:
						return "people";
				}
			}

			const base = type.toLowerCase();
			return base === "ranobe" ? base : `${base}s`;
		};

		let user;
		let favourites;

		try {
			user = await fetchJSON("/api/users/whoami");
			favourites = await fetchJSON(`/api/users/${user.id}/favourites`);
		} catch (error) {
			error(error.message);
			return;
		}

		const buttons = document.querySelectorAll(
			'a.b-subposter-action[data-remote="true"][href^="/api/favorites/"]',
		);

		buttons.forEach((button) => {
			const parts = button.getAttribute("href").split("/");
			const type = parts.at(-2);
			const id = Number(parts.at(-1));
			const kind = button.getAttribute("data-kind") || "";

			const key = resolveFavoritesKey(type, kind);
			const favList = favourites[key] || [];

			const isFavorite = favList.some((item) => item.id === id);
			setButtonState(button, isFavorite);

			button.addEventListener("click", async (e) => {
				e.preventDefault();

				const adding = button.classList.contains("fav-add");
				const success = await toggleFavorite(type, id, adding);

				if (!success) {
					error("Failed to toggle favorite");
					return;
				}

				setButtonState(button, adding);
			});
		});
	}

	// PATCH личной оценки/прогресса (тот же эндпоинт, что у статуса).
	const patchUserRate = async (rateId, payload) => {
		const csrf =
			document.querySelector('meta[name="csrf-token"]')?.content || "";
		const res = await fetchWithTimeout(`/api/v2/user_rates/${rateId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
			body: JSON.stringify({ user_rate: payload }),
		});
		if (!res.ok) throw new Error(`user_rate PATCH ${res.status}`);
		return res.json();
	};

	// Обработчики виджетов прогресса (серии/главы +/−) и личной оценки (звёзды).
	const setupUserRateExtras = () => {
		document.body.addEventListener("click", async (e) => {
			const box = e.target.closest(".fix404-userrate-extras");
			if (!box) return;
			const rateId = box.dataset.rateId;
			const field = box.dataset.field;
			const total = Number(box.dataset.total) || 0;

			// 1. Прогресс серий/глав
			const btn = e.target.closest(".fix404-ur-btn[data-act]");
			if (btn) {
				const watchedEl = box.querySelector(".fix404-ur-watched");
				let val = Number(watchedEl.textContent) || 0;
				val += btn.dataset.act === "inc" ? 1 : -1;
				if (val < 0) val = 0;
				if (total && val > total) val = total;
				watchedEl.textContent = val; // оптимистичный апдейт
				try {
					await patchUserRate(rateId, { [field]: val });
				} catch (err) {
					error("Обновление прогресса не удалось:", err.message);
				}
				return;
			}

			// 2. Личная оценка
			const star = e.target.closest(".fix404-ur-star");
			if (star) {
				let score = Number(star.dataset.val);
				const numEl = box.querySelector(".fix404-ur-score-num");
				const cur = Number(numEl.textContent) || 0;
				if (score === cur) score = 0; // повторный клик -> снять оценку
				box.querySelectorAll(".fix404-ur-star").forEach((s) => {
					s.style.color =
						Number(s.dataset.val) <= score
							? "#f0b400"
							: "rgba(140,140,140,.45)";
				});
				numEl.textContent = score || "";
				const lbl = box.querySelector(".fix404-ur-score-label");
				if (lbl) lbl.textContent = score ? getScoreText(score) : "";
				try {
					await patchUserRate(rateId, { score });
				} catch (err) {
					error("Обновление оценки не удалось:", err.message);
				}
				return;
			}
		});
		log("Обработчик прогресса/оценки активирован");
	};

	const setupUserRateHandlers = () => {
		// Используем делегирование: вешаем один слушатель на body
		document.body.addEventListener("click", async (e) => {
			// 1. КЛИК ПО СТРЕЛКЕ ИЛИ ТЕЛУ КНОПКИ (Открыть/Закрыть меню)
			const trigger = e.target.closest(".b-add_to_list .trigger");
			if (trigger) {
				e.preventDefault();
				e.stopPropagation();

				const container = trigger.closest(".b-add_to_list");
				const expanded = container.querySelector(".expanded-options");

				// Закрываем все остальные открытые меню
				document.querySelectorAll(".expanded-options").forEach((el) => {
					if (el !== expanded) {
						el.style.display = "none";
						el.closest(".b-add_to_list")?.classList.remove("expanded");
					}
				});

				// Тогглим текущее
				const isVisible = expanded.style.display === "block";
				expanded.style.display = isVisible ? "none" : "block";
				container.classList.toggle("expanded", !isVisible);
				return;
			}

			// 2. КЛИК ПО ОПЦИИ (Смена статуса или Удаление)
			const option = e.target.closest(
				".b-add_to_list .expanded-options .option",
			);
			const directAdd = e.target.closest(
				".b-add_to_list .trigger .add-trigger",
			);

			const actionElement = option || directAdd;

			if (actionElement) {
				e.preventDefault();

				const container = actionElement.closest(".b-add_to_list");
				const form = container.querySelector("form");
				const expanded = container.querySelector(".expanded-options");

				const newStatus = actionElement.dataset.status;
				const targetType = form.querySelector(
					'input[name="user_rate[target_type]"]',
				).value;
				const targetId = form.querySelector(
					'input[name="user_rate[target_id]"]',
				).value;
				const userId = form.querySelector(
					'input[name="user_rate[user_id]"]',
				).value;

				const csrfToken = document.querySelector(
					'meta[name="csrf-token"]',
				)?.content;

				// --- ЛОГИКА УДАЛЕНИЯ ---
				if (newStatus === "delete") {
					const deleteUrl = form.getAttribute("action");

					// 1. Сбрасываем внешний вид на "Запланировано" (синяя кнопка)
					container.className = "b-add_to_list planned";
                    container.classList.remove("expanded"); // Убираем стрелочку вверх

					// 2. Восстанавливаем триггер "Добавить в список"
					const triggerDiv = container.querySelector(".trigger");
					triggerDiv.innerHTML = `
                    <div class="trigger-arrow"></div>
                    <div class="text add-trigger" data-status="planned">
                        <div class="plus"></div>
                        <span class="status-name" data-text="${STATUS_DATA.common.add}"></span>
                    </div>`;

                    // 3. ВОССТАНАВЛИВАЕМ СПИСОК ОПЦИЙ (Fix бага с пустым списком)
                    // Нам нужно вернуть список (Смотрю, В планах...), но БЕЗ кнопки удалить
                    const typeKey = targetType.toLowerCase() === 'ranobe' ? 'manga' : targetType.toLowerCase();
                    const texts = STATUS_DATA[typeKey] || STATUS_DATA.anime; // Берем тексты из глобальной константы

                    const optionsHtml = Object.keys(STATUS_CLASSES).map(key => `
                        <div class="option add-trigger" data-status="${key}">
                            <div class="text"><span class="status-name" data-text="${texts[key]}"></span></div>
                        </div>
                    `).join('');

					container.querySelector(".expanded-options").innerHTML = optionsHtml;

                    // 4. Отправляем запрос на удаление
					fetch(deleteUrl, {
						method: "DELETE",
						headers: {
							"X-CSRF-Token": csrfToken,
							"Content-Type": "application/json",
						},
					}).then(() => {
						log(`Запись удалена: ${targetId}`);
						form.setAttribute("action", "/api/v2/user_rates");
					});

					if (expanded) expanded.style.display = "none";
					return;
				}

				// --- ЛОГИКА ДОБАВЛЕНИЯ / ИЗМЕНЕНИЯ ---

				// 1. Оптимистичное обновление UI
				Object.values(STATUS_CLASSES).forEach((c) =>
					container.classList.remove(c),
				);
				container.classList.add(STATUS_CLASSES[newStatus]);

				const typeKey = targetType.toLowerCase() === 'ranobe' ? 'manga' : targetType.toLowerCase();
				const statusText = STATUS_DATA[typeKey][newStatus];

				const triggerDiv = container.querySelector(".trigger");
				if (triggerDiv.querySelector(".add-trigger")) {
					triggerDiv.innerHTML = `
                    <div class="trigger-arrow"></div>
                    <div class="edit-trigger">
                        <div class="edit"></div>
                        <div class="text"><span class="status-name" data-text="${statusText}"></span></div>
                    </div>`;
				} else {
					const textSpan = triggerDiv.querySelector(".status-name");
					if (textSpan) {
						textSpan.textContent = "";
						textSpan.dataset.text = statusText;
					}
				}

				if (expanded) expanded.style.display = "none";
				container.classList.remove("expanded");

				// 2. Подготовка запроса
				const currentAction = form.getAttribute("action");
				const isPatch = currentAction.match(/\/(\d+)$/);

				const method = isPatch ? "PATCH" : "POST";
				// Нормализуем targetType для API: Ranobe -> Manga
				const apiTargetType = targetType === "Ranobe" ? "Manga" : targetType;
				const body = {
					user_rate: {
						user_id: userId,
						target_id: targetId,
						target_type: apiTargetType,
						status: newStatus,
					},
				};

				try {
					const resp = await fetchWithTimeout(currentAction, {
						method: method,
						headers: {
							"Content-Type": "application/json",
							"X-CSRF-Token": csrfToken,
						},
						body: JSON.stringify(body),
					});

					if (!resp.ok) throw new Error("Network error");

					const data = await resp.json();

					if (method === "POST" && data.id) {
						form.setAttribute(
							"action",
							`/api/v2/user_rates/${data.id}`,
						);

						const optionsDiv =
							container.querySelector(".expanded-options");
						if (!optionsDiv.querySelector(".remove-trigger")) {
							const removeDiv = document.createElement("div");
							removeDiv.className = "option remove-trigger";
							removeDiv.dataset.status = "delete";
							removeDiv.innerHTML = `<div class="text"><span class="status-name" data-text="${STATUS_DATA.common.remove}"></span></div>`;
							optionsDiv.appendChild(removeDiv);
						}
					}
					log(`Статус обновлен: ${newStatus} (ID: ${data.id})`);
				} catch (err) {
					error("Ошибка обновления статуса", err);
				}
			}

			// 3. КЛИК СНАРУЖИ
			if (!e.target.closest(".b-add_to_list")) {
				closeAllExpandedMenus();
			}
		});

		log("Обработчики UserRates (Universal) активированы");
	};

	/**
	 * @description Искусственно вызывает события загрузки страницы, чтобы "оживить" JS-компоненты Shikimori.
	 */
	const triggerPageLoadEvents = () => {
		log("⚡️ Вызываю события загрузки страницы (turbolinks:load)...");
		// Основное событие для Turbolinks
		document.dispatchEvent(new Event("turbolinks:load"));
		// Дополнительное стандартное событие на всякий случай
		document.dispatchEvent(new Event("DOMContentLoaded"));
		// Для совместимости со старыми версиями
		document.dispatchEvent(new Event("page:load"));
		// Кастомное событие для других скриптов, которым нужно переинициализироваться
		document.dispatchEvent(new CustomEvent("404fix:restored", {
			detail: {
				timestamp: Date.now(),
				url: window.location.href
			}
		}));
	};

	/**
	 * Credits: https://shikimori.one/forum/site/610497-shikiutils
	 * Injects into the .scores block.
	 */
	async function injectExtraScores() {
		// --- НАСТРОЙКИ ---
		const CFG = {
			showShikiAvg: true,
			showAniList: true,
			displayMode: "stars", // 'stars' или 'headline'
			labels: {
				shiki: "Средний балл Шикимори",
				anilist: "AniList",
				mal: "MyAnimeList",
			},
		};

		const scoreBlock = document.querySelector(".scores");
		if (!scoreBlock) return;

		const originalRate = scoreBlock.querySelector(".b-rate"); // Находим оригинальный блок

		if (
			originalRate &&
			!originalRate.classList.contains("shiki-average-score") &&
			!originalRate.classList.contains("anilist-average-score")
		) {
			// Проверяем, не добавили ли мы уже подпись
			if (!scoreBlock.querySelector(".mal-label")) {
				const labelP = document.createElement("p");
				labelP.className = "score mal-label";
				labelP.style.marginTop = "2px";
				labelP.style.fontSize = "12px";
				labelP.style.color = "#999";
				labelP.style.textAlign = "center";
				labelP.textContent = "Оценка MAL"; // Источник "дефолтной" оценки

				originalRate.insertAdjacentElement("afterend", labelP);
			}
		}

		// ==========================================
		// 1. SHIKIMORI (Расчет среднего)
		// ==========================================
		if (CFG.showShikiAvg) {
			const statsEl = document.querySelector("#rates_scores_stats");
			if (statsEl && statsEl.dataset.stats) {
				try {
					const stats = JSON.parse(statsEl.dataset.stats);
					let total = 0,
						sum = 0;

					// Универсальный парсинг (поддерживает и массивы массивов, и объекты)
					const entries = Array.isArray(stats)
						? stats
						: Object.entries(stats);

					for (const [s, c] of entries) {
						const score = Number(s);
						const count = Number(c);
						if (!isNaN(score) && !isNaN(count)) {
							sum += score * count;
							total += count;
						}
					}

					if (total > 0) {
						const avg = (sum / total).toFixed(2);

						// ВЫЗОВ НОВОЙ ФУНКЦИИ
						renderRating({
							container: scoreBlock,
							score: avg,
							key: "shiki",
							label: CFG.labels.shiki,
							mode: CFG.displayMode,
						});

						// (Опционально) Доп. инфо "Всего оценок"
						if (!statsEl.querySelector(".total-rates")) {
							const totalEl = document.createElement("div");
							totalEl.className = "total-rates";
							totalEl.style.cssText =
								"margin-top: 5px; color: #999; font-size: 11px; text-align: center;";
							totalEl.textContent = `Всего оценок: ${total}`;
							statsEl.appendChild(totalEl);
						}
					}
				} catch (e) {
					console.error("Shiki calc error:", e);
				}
			}
		}

		// ==========================================
		// 2. ANILIST (Запрос к API)
		// ==========================================
		if (CFG.showAniList) {
			// Поиск названия
			const nameElement =
				document.querySelector('meta[property="og:title"]') ||
				document.querySelector(
					'.b-breadcrumbs .b-link[href*="/animes/"] span',
				);

			let searchTitle = nameElement
				? nameElement.getAttribute("content")
				: document.title;
			// Очистка от "RuName / EnName"
			if (searchTitle.includes("/"))
				searchTitle = searchTitle.split("/")[1].trim();

			if (searchTitle) {
				const isManga =
					location.pathname.includes("/mangas/") ||
					location.pathname.includes("/ranobe/");
				const type = isManga ? "MANGA" : "ANIME";

				const query = `query ($search: String) { Media(search: $search, type: ${type}) { averageScore } }`;

				try {
					const res = await fetchWithTimeout("https://graphql.anilist.co", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "application/json",
						},
						body: JSON.stringify({
							query,
							variables: { search: searchTitle },
						}),
					});

					const data = await res.json();
					const aniScoreRaw = data?.data?.Media?.averageScore;

					if (aniScoreRaw) {
						const aniScore = (aniScoreRaw / 10).toFixed(2); // 100 -> 10.0

						// ВЫЗОВ НОВОЙ ФУНКЦИИ
						renderRating({
							container: scoreBlock,
							score: aniScore,
							key: "anilist",
							label: CFG.labels.anilist,
							mode: CFG.displayMode,
						});
					}
				} catch (e) {
					console.error("AniList Fetch Error:", e);
				}
			}
		}
	}

	/**
	 * Credits: https://shikimori.one/forum/site/610497-shikiutils
	 * Calculates total watch time based on episodes and duration.
	 */
	function injectWatchTime() {
		// --- SETTINGS ---
		const CFG = {
			enabled: true,
			template: "Всего времени:",
		};

		if (!CFG.enabled) return;

		// Helper: Pluralization (день, дня, дней)
		const getPluralForm = (number, one, two, five) => {
			const n = Math.abs(number);
			const n1 = n % 10;
			const n2 = n % 100;
			if (n2 > 10 && n2 < 20) return five;
			if (n1 > 1 && n1 < 5) return two;
			if (n1 === 1) return one;
			return five;
		};

		// Helper: Parse duration string
		const parseDur = (text) => {
			const t = text.toLowerCase();
			const h = /(\d+)\s*(?:час|hour)/.exec(t);
			const m = /(\d+)\s*(?:мин|min)/.exec(t);
			return (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0);
		};

		// Helper: Format minutes to string
		const formatTime = (totalMins) => {
			const days = Math.floor(totalMins / 1440);
			const hours = Math.floor((totalMins % 1440) / 60);
			const mins = totalMins % 60;

			const parts = [];
			if (days > 0)
				parts.push(
					`${days} ${getPluralForm(days, "день", "дня", "дней")}`,
				);
			if (hours > 0)
				parts.push(
					`${hours} ${getPluralForm(hours, "час", "часа", "часов")}`,
				);
			if (mins > 0)
				parts.push(
					`${mins} ${getPluralForm(
						mins,
						"минута",
						"минуты",
						"минут",
					)}`,
				);
			return parts.join(", ");
		};

		try {
			const infoBlock = document.querySelector(".b-entry-info");
			if (!infoBlock) return;

			// Find necessary lines by key text
			const findLine = (...keys) => {
				const lines = infoBlock.querySelectorAll(
					".line-container .line",
				);
				for (let line of lines) {
					const keyEl = line.querySelector(".key");
					if (!keyEl) continue;
					if (
						keys.some((k) =>
							keyEl.textContent
								.toLowerCase()
								.includes(k.toLowerCase()),
						)
					) {
						return line;
					}
				}
				return null;
			};

			const epLine = findLine("Эпизоды", "Episodes");
			const durLine = findLine("Длительность", "Duration");

			if (!epLine) return;

			const epValue = parseInt(
				epLine.querySelector(".value")?.textContent.trim(),
			);
			const durText = durLine
				? durLine.querySelector(".value")?.textContent.trim()
				: "0 мин";
			const durMins = parseDur(durText);

			if (!epValue || !durMins) return;

			const totalTime = epValue * durMins;

			// Prevent duplicates
			if (!document.querySelector(".time-block")) {
				const timeBlock = document.createElement("div");
				timeBlock.className = "line-container time-block"; // Matches template structure
				timeBlock.innerHTML = `
                    <div class="line">
                        <div class="key">${CFG.template}</div>
                        <div class="value">${formatTime(totalTime)}</div>
                    </div>`;

				// Insert after duration or at the end of block
				if (durLine) {
					durLine.closest(".line-container").after(timeBlock);
				} else {
					infoBlock.appendChild(timeBlock);
				}
			}
		} catch (err) {
			error("WatchTime Error:", err);
		}
	}

	/**
	 * Credits: https://shikimori.one/forum/site/610497-shikiutils
	 * 1. Calculates average score for "Friends" or "Statuses" bars.
	 * 2. Fetches detailed info (episodes/chapters) for friends in the list.
	 */
	async function enhanceSidebarStats() {
		const CFG = {
			calcAvg: true, // Считать среднее по полоскам
			fetchDetails: true, // Грузить эпизоды друзей
			avgTemplate: "Средний балл: {avg}",
			showZero: true, // Показывать (0 эп.)
		};

		// --- 1. Average Score Calculation (Generic) ---
		if (CFG.calcAvg) {
			document
				.querySelectorAll(".bar.simple.horizontal")
				.forEach((barBlock) => {
					// Find the subheadline relative to this bar
					const parentBlock = barBlock.closest(".block");
					const head = parentBlock
						? parentBlock.querySelector(".subheadline")
						: null;

					if (head && head.querySelector("[data-avg-added]")) return; // Skip if done

					let sum = 0,
						total = 0;
					let hasScore = false;

					// Try to parse scores from lines (works for "Friends" block if scores are visible like "10")
					// Or from graph bars (works for "User Ratings")
					barBlock.querySelectorAll(".line").forEach((line) => {
						// Try getting score from label (User rates graph)
						let score = parseInt(
							line.querySelector(".x_label")?.textContent,
						);
						let count = 0;

						// If not found, try getting from text (Friends list: "Watching - 10")
						if (isNaN(score)) {
							const statusText = line.textContent;
							const match = statusText.match(/–\s*(\d+)/);
							if (match) {
								score = parseInt(match[1]);
								count = 1; // Each line is 1 friend
							}
						} else {
							// It's a graph bar
							const bar = line.querySelector(".bar");
							count =
								parseInt(bar?.getAttribute("title")) ||
								parseInt(
									bar?.querySelector(".value")?.textContent,
								);
						}

						if (!isNaN(score) && !isNaN(count) && count > 0) {
							sum += score * count;
							total += count;
							hasScore = true;
						}
					});

					if (hasScore && total > 0) {
						const avg = (sum / total).toFixed(2);

						// Inject into headline
						if (head) {
							const marker = document.createElement("span");
							marker.dataset.avgAdded = "true";
							marker.style.fontSize = "12px";
							marker.style.color = "#888";
							marker.style.marginLeft = "10px";
							marker.textContent = `(${avg})`;
							head.appendChild(marker);
						}
					}
				});
		}

		// --- 2. Fetch Detailed Friend Info ---
		if (CFG.fetchDetails) {
			// Need to know WHO we are checking.
			// Try to get IDs from URL or DOM.
			const path = window.location.pathname;
			const animeMatch = path.match(/\/(animes|mangas|ranobe)\/(\d+)/);
			if (!animeMatch) return;

			const targetId = animeMatch[2];
			const isManga =
				path.includes("/mangas/") || path.includes("/ranobe/");
			const targetType = isManga ? "Manga" : "Anime";

			// Find friends block
			const friendsBlock = document.querySelector(
				".b-animes-menu .block",
			);
			// Note: In 404Fix script, this might be the "If you know how to return..." placeholder.
			// The logic below only works if there are actual friend lines.
			if (!friendsBlock) return;

			const friendLines = Array.from(
				friendsBlock.querySelectorAll(
					".b-menu-line.friend-rate, .b-show_more-more .friend-rate",
				),
			);
			if (friendLines.length === 0) return;

			// Get Current User ID for API context?
			// Actually we need the FRIEND'S ID.
			// Standard Shikimori renders friend link as <a href="/nickname" title="nickname">
			// We need to resolve nickname -> ID.

			// Let's try to get ID from avatar image URL (often contains ID) or we have to fetch profile.

			for (const line of friendLines) {
				const userLink = line.querySelector(
					`a[href^='${CONFIG.SITE_NAME}/']`,
				); // or internal link
				if (!userLink) continue;

				// Extract ID from avatar if possible to save a request
				// src=".../users/x48/12345.png"
				const img = line.querySelector("img");
				let friendId = null;
				if (img && img.src) {
					const m = img.src.match(/\/users\/[a-z0-9]+\/(\d+)\./);
					if (m) friendId = m[1];
				}

				// If we have ID, fetch rates
				if (friendId) {
					try {
						const userRates = await apiRequest(
							`/v2/user_rates?user_id=${friendId}&target_type=${targetType}&target_id=${targetId}`,
						);
						// API returns array. Should be 1 item since we filtered by target_id
						const rate = userRates[0];

						if (rate) {
							const statusEl = line.querySelector(".status"); // Assuming standard structure
							if (statusEl) {
								let text = statusEl.textContent
									.split("–")[0]
									.trim(); // "Смотрю"

								if (rate.score > 0) text += ` – ${rate.score}`;

								const progress = isManga
									? rate.chapters
									: rate.episodes;
								if (
									progress > 0 ||
									(progress === 0 && CFG.showZero)
								) {
									text += ` (${progress} ${
										isManga ? "гл." : "эп."
									})`;
								}

								statusEl.textContent = text;
							}
						}
					} catch (e) {
						error(`Failed to fetch rate for friend ${friendId}`, e);
					}
				}
			}
		}
	}

	// --- Основная логика ---
	// Назначается в точке входа; вызывается после document.write, т.к. он стирает
	// глобальные слушатели (и document, и window) — их надо навесить заново.
	let __attachGlobalHandlers = null;

	let renderEntityPage = async (id, type, displayType) => {
		const startTime = performance.now();
		try {
			// 1. СРАЗУ запускаем парсинг донорской страницы (кеш на сессию)
			const assetsPromise = getPageAssetsCached();

			// 2. Запускаем сбор основных данных. Передаем туда assetsPromise!
			// getEntityData и getPageAssets работают параллельно.
			const pageDataPromise = getEntityData(id, type, displayType, assetsPromise);

			// Дожидаемся окончания обоих процессов
			const pageAssets = await assetsPromise;
			const pageData = await pageDataPromise;

			pageData.ASSETS = pageAssets;

			// Извлекаем юзера и CSS
			const currentUser = pageAssets.USER_DATA;
			if (currentUser) {
				pageData.USER = currentUser;

				// Используем CSS из донора, если разрешено настройками
				if (CONFIG.USE_DONOR_CSS && pageAssets.CUSTOM_CSS !== null) {
					pageData.USER_CSS = pageAssets.CUSTOM_CSS;
				} else {
					// Fallback: если отключено, можно использовать getUserStyle
					pageData.USER_CSS = await getUserStyle(currentUser?.USER_ID);
				}
			} else {
				pageData.USER_CSS = null;
			}

			const renderedHTML = renderTemplate(ANIME_HTML_TEMPLATE, pageData);

			hideLoader();

			// document.write уничтожит Turbolinks -> включаем перезагрузку на back/forward.
			__spaDestroyed = true;

			/* В будущем эти 3 строки могут сломаться */
			document.open();
			document.write(renderedHTML);
			document.close();

			// document.write стёр ВСЕ глобальные слушатели (document и window) и сбросил
			// documentElement/body. Навешиваем всё заново: префетч и перехват клика для
			// "Похожее"/"Связанное", popstate-guard, тултип- и постер-фиксы.
			if (__attachGlobalHandlers) __attachGlobalHandlers();

			setTimeout(async () => {
				triggerPageLoadEvents();
				setupReplyButtons();
				setupQuoteButtons();
				setupShowMoreHandlers();
				setupCommentsLoadMore();
				setupFavoriteButton();

				injectExtraScores();
				injectWatchTime();
				enhanceSidebarStats();
			}, 150);

			setTimeout(triggerPageLoadEvents, 0);

			// user_rate: основной путь — нативная гидрация shikimori (.b-user_rate.to-process,
			// её запускает triggerPageLoadEvents). ФОЛБЭК: если за ~2.5с виджет не отрисовался —
			// рисуем кастомную кнопку статуса + виджеты прогресса/оценки и вешаем их обработчики.
			setTimeout(() => {
				const ur = document.querySelector(".b-user_rate");
				if (!ur || ur.children.length > 0) return; // нативно отрисовалось — ничего не делаем
				log("user_rate: нативная гидрация не сработала -> кастомный фолбэк");
				const typeUp =
					pageData.TYPE === "anime"
						? "Anime"
						: pageData.TYPE === "ranobe"
							? "Ranobe"
							: "Manga";
				ur.innerHTML =
					renderUserRateButton(
						pageData.INFO.ID,
						typeUp,
						pageData.USER?.USER_ID || null,
						pageData.LIST_STATUS,
					) + renderUserRateExtras(pageData);
				setupUserRateHandlers();
				setupUserRateExtras();
			}, 2500);
		} catch (e) {
			error(`Ошибка при рендере страницы для аниме ID ${id}:`, e.message);
			error(e.stack);
			document.body.innerHTML = `<div class="b-dialog"><div class="inner"><h1>Error</h1><p>${e.message}</p></div></div>`;
			document.body.innerHTML += `<div class="b-dialog"><div class="inner"><h2>Stack</h2><p>${e.stack}</p></div></div>`;
		} finally {
			const endTime = performance.now();
			const duration = (endTime - startTime).toFixed(2);
			log(`✅ Страница полностью отрисована за ${duration} мс.`);
		}
	};

    // Документация по:
    // - init()
    // - debugInit()
    // - restorePage()
	//
    // 1. Обычный запуск (авто-режим на 404 странице):
    // init();
    //
    // 2. Явный запуск на текущем URL:
    // init(window.location.href);
    //
    // 3. Ручной запуск другого URL (НО с 404-guard):
    // init("https://shikimori.io/animes/62584-title");
    //
    // 4. Принудительный запуск (игнорирует 404 проверку):
    // init("https://shikimori.io/animes/62584-title", { force: true });
    //
    // 5. Debug-алиас (то же самое что force:true):
    // debugInit("https://shikimori.io/animes/62584-title");
    //
    // 6. Из консоли браузера:
    // init()
    // init(url)
    // debugInit(url)
    //
    // 7. Ручное восстановление страницы по ID и типу (без проверки URL и 404):
    // restorePage(855, "anime")
    // restorePage(123, "anime", "anime")

    window.restorePage = async (id, type, displayType) => {
        renderEntityPage(id, type, displayType);
        log(`🔄 Ручное восстановление ${displayType || type} ID: ${id}`);
    };

    const init = (testUrl = window.location.href, options = {}) => {
        // testUrl — используется для ручного дебага из консоли
        // по умолчанию берётся текущий URL страницы
        const url = new URL(testUrl);
        const pathname = url.pathname;

        // Запускаем только на страницах:
        // /animes/*
        // /mangas/*
        // /ranobe/*
        const match = pathname.match(/^\/(animes|mangas|ranobe)\/([a-z0-9-]+)/i);
        if (!match) {
            console.log('[INIT] no route match');
            return;
        }

        // Проверяем, что это действительно 404-страница
        // По умолчанию выполняется только на 404 страницах
        // options.force отключает это поведение (debug mode)
        const title = document.title.trim();

        if (!options.force && !/^404(\s|$)/i.test(title)) {
            console.log('[INIT] not 404 page');
            return;
        }

        // Кастомная страница загрузки (заглушка)
        // const custom404Html = '...';
        // document.documentElement.innerHTML = custom404Html;

        const typePlural = match[1].toLowerCase();

        // Из slug вида "855-strawberry-panic" получаем числовой ID
        const idMatch = match[2].match(/^(?:z)?(\d+)(?:-|$)/i);
        if (!idMatch) {
            console.log('[INIT] no numeric id');
            return;
        }

        const id = idMatch[1];

        // Для API ranobe использует тип manga
        const type = typePlural === 'ranobe'
        ? 'manga'
        : typePlural.slice(0, -1);

        // Для отображения сохраняем исходный тип
        const displayType = typePlural === 'ranobe'
        ? 'ranobe'
        : typePlural.slice(0, -1);

        console.log('[INIT] resolved:', {
            id,
            type,
            displayType
        });

        // Тестовый режим логики
        if (typeof showLoader === 'function') {
            showLoader();
        } else {
            console.log('[INIT] showLoader() skipped (not defined)');
        }

        if (typeof renderEntityPage === 'function') {
            renderEntityPage(id, type, displayType);
        } else {
            console.log('[INIT] renderEntityPage skipped (not defined)');
        }
    };

	// =====================================================================
	// ПОСТЕРЫ НА ОБЫЧНЫХ СТРАНИЦАХ (каталог / списки / профиль / детальная)
	// Порт скрипта "Shikimori — постер с MyAnimeList", но источник — Jikan
	// (CORS-дружелюбное зеркало MAL) -> работает на @grant none, без Client ID.
	// =====================================================================
	const POSTER_MISSING_MAIN_RE = /\/assets\/globals\/missing\/main(@2x)?\.png/;
	const POSTER_MISSING_CATALOG_RE =
		/\/assets\/globals\/missing\/preview_animanga(@2x)?\.png/;
	const POSTER_VIEW_MARGIN = 400;
	const POSTER_BATCH = 3;

	// Кэш shiki id -> mal id и кэш постеров Jikan.
	const shikiToMalCache = new Map();
	const jikanPosterCache = new PersistentLRUCache(
		"jikan_poster",
		200,
		CONFIG.JIKAN_CACHE_TTL,
	);

	const posterIsAnimeKind = (kind) => kind === "anime";

	// shiki -> mal id (через /api, как в оригинале). Падение -> используем shiki id.
	const resolveMalId = async (id, kind) => {
		const key = `${kind}:${id}`;
		if (shikiToMalCache.has(key)) return shikiToMalCache.get(key);
		const seg =
			kind === "anime" ? "animes" : kind === "manga" ? "mangas" : "ranobe";
		let malId = id;
		try {
			const r = await fetchWithTimeout(`${location.origin}/api/${seg}/${id}`, {
				headers: { Accept: "application/json" },
			});
			if (r.ok) {
				const d = await r.json();
				if (d.myanimelist_id != null) malId = String(d.myanimelist_id);
			}
		} catch (e) {
			/* оставляем shiki id */
		}
		shikiToMalCache.set(key, malId);
		return malId;
	};

	// Главный постер с Jikan -> { large, medium } | null. Кэш + ретрай на 429.
	const getJikanPoster = async (malId, kind) => {
		const type = posterIsAnimeKind(kind) ? "anime" : "manga";
		const cacheKey = `${type}_${malId}`;
		const cached = jikanPosterCache.get(cacheKey);
		if (cached !== undefined && cached !== null) return cached;
		try {
			const json = await withRetry(
				async () => {
					const res = await fetchWithTimeout(
						`${CONFIG.JIKAN_BASE}/${type}/${malId}`,
						{ headers: { "User-Agent": CONFIG.USER_AGENT } },
					);
					if (!res.ok) {
						const e = new Error(`Jikan ${res.status}`);
						e.status = res.status;
						throw e;
					}
					return res.json();
				},
				{ label: "Jikan poster", retries: 3, baseDelay: 600 },
			);
			const jpg = json?.data?.images?.jpg || {};
			const large = jpg.large_image_url || jpg.image_url || null;
			const medium = jpg.image_url || jpg.large_image_url || null;
			const pic = large || medium ? { large: large || medium, medium: medium || large } : null;
			jikanPosterCache.set(cacheKey, pic);
			return pic;
		} catch (e) {
			debug(`Jikan постер не получен для ${type} ${malId}: ${e.message}`);
			return null;
		}
	};

	const fetchPosterPic = async (id, kind) => {
		const malId = await resolveMalId(id, kind);
		return getJikanPoster(malId, kind);
	};

	// --- применение постеров к разным версткам (как в оригинале) ---
	const applyDetailPoster = (posterRoot, pic) => {
		if (!pic) return;
		const meta = posterRoot.querySelector('meta[itemprop="image"]');
		const img = posterRoot.querySelector("img");
		if (meta) meta.setAttribute("content", pic.large);
		if (img) {
			img.src = pic.medium;
			img.srcset = `${pic.large} 2x, ${pic.medium} 1x`;
			img.removeAttribute("data-src");
		}
	};
	const applyCatalogPoster = (row, pic) => {
		if (!pic) return;
		const img = row.querySelector(".image-cutter img");
		const metaImage = row.querySelector('meta[itemprop="image"]');
		const metaThumb = row.querySelector('meta[itemprop="thumbnailUrl"]');
		if (metaImage) metaImage.setAttribute("content", pic.large);
		if (metaThumb) metaThumb.setAttribute("content", pic.medium);
		if (img) {
			img.src = pic.medium;
			img.srcset = `${pic.large} 2x, ${pic.medium} 1x`;
			img.removeAttribute("data-src");
		}
	};
	const applyLineListPoster = (tr, pic) => {
		if (!pic) return;
		const tdName = tr.querySelector("td.name");
		if (!tdName) return;
		let wrap = tr.querySelector(".mal-userlist-poster");
		if (!wrap) {
			wrap = document.createElement("span");
			wrap.className = "mal-userlist-poster";
			wrap.style.cssText =
				"display:inline-block;vertical-align:middle;margin:0 10px 0 0;width:40px;";
			const im = document.createElement("img");
			im.alt = "";
			im.style.cssText =
				"display:block;width:40px;height:56px;object-fit:cover;border-radius:4px;";
			wrap.appendChild(im);
			tdName.insertBefore(wrap, tdName.firstChild);
		}
		const img = wrap.querySelector("img");
		if (img) {
			img.src = pic.medium;
			img.srcset = `${pic.large} 2x, ${pic.medium} 1x`;
		}
	};

	// --- определение сущностей в разных вёрстках ---
	const isUserAnimeListPage = () => /^\/[^/]+\/list\/anime/.test(location.pathname);
	const isUserMangaListPage = () => /^\/[^/]+\/list\/manga/.test(location.pathname);
	const isUserListLinesPage = () =>
		isUserAnimeListPage() || isUserMangaListPage();
	const posterEntryKey = (info) => `${info.kind}:${info.id}`;

	const getGridEntryInfo = (el) => {
		if (el.matches("article.b-catalog_entry.c-anime") && el.id)
			return { id: el.id, kind: "anime" };
		if (el.matches("article.b-catalog_entry.c-manga") && el.id)
			return { id: el.id, kind: "manga" };
		if (el.matches(".c-column.user_rate") && el.closest(".list-posters")) {
			const link = el.querySelector("a.cover[href], a[href]");
			const href = (link && link.getAttribute("href")) || "";
			let m = href.match(/\/animes\/(\d+)/);
			if (m) return { id: m[1], kind: "anime" };
			m = href.match(/\/mangas\/(\d+)/);
			if (m) return { id: m[1], kind: "manga" };
			m = href.match(/\/ranobe\/(\d+)/);
			if (m) return { id: m[1], kind: "ranobe" };
			const tid = el.getAttribute("data-target_id");
			if (tid && /^\d+$/.test(tid)) {
				if (isUserAnimeListPage()) return { id: tid, kind: "anime" };
				if (isUserMangaListPage()) return { id: tid, kind: "manga" };
			}
		}
		return null;
	};
	const getLineListEntryInfo = (tr) => {
		if (!tr.matches("tr.user_rate") || !tr.closest("table.list-lines")) return null;
		const a = tr.querySelector("td.name a[href]");
		const href = (a && a.getAttribute("href")) || "";
		let m = href.match(/\/animes\/(\d+)/);
		if (m && isUserAnimeListPage()) return { id: m[1], kind: "anime" };
		m = href.match(/\/mangas\/(\d+)/);
		if (m && isUserMangaListPage()) return { id: m[1], kind: "manga" };
		m = href.match(/\/ranobe\/(\d+)/);
		if (m && isUserMangaListPage()) return { id: m[1], kind: "ranobe" };
		const tid = tr.getAttribute("data-target_id");
		if (tid && /^\d+$/.test(tid)) {
			if (isUserAnimeListPage()) return { id: tid, kind: "anime" };
			if (isUserMangaListPage()) return { id: tid, kind: "manga" };
		}
		return null;
	};

	const needsGridPosterFix = (el) => {
		const info = getGridEntryInfo(el);
		if (!info) return false;
		const img = el.querySelector(".image-cutter img");
		if (!img || !POSTER_MISSING_CATALOG_RE.test(img.getAttribute("src") || ""))
			return false;
		const k = posterEntryKey(info);
		if (el.dataset.malPosterResolved === k) return false;
		if (el.dataset.malPosterBusy === k) return false;
		return true;
	};
	const needsLineListFix = (tr) => {
		if (!isUserListLinesPage()) return false;
		const info = getLineListEntryInfo(tr);
		if (!info) return false;
		const k = posterEntryKey(info);
		const prev = tr.dataset.malPosterResolved;
		if (prev && prev !== k) {
			tr.querySelector(".mal-userlist-poster")?.remove();
			delete tr.dataset.malPosterResolved;
		}
		if (tr.dataset.malPosterResolved === k) return false;
		if (tr.dataset.malPosterBusy === k) return false;
		if (tr.querySelector(".mal-userlist-poster")) return false;
		return true;
	};
	// --- История в профиле (.c-history .entry) ---
	const getHistoryInfo = (el) => {
		if (!el.matches || !el.matches(".c-history .entry")) return null;
		const a = el.querySelector("a[href]");
		const p = parseEntityLink((a && a.getAttribute("href")) || "");
		return p ? { id: p.id, kind: p.displayType } : null;
	};
	const coverMissing = (img) => {
		const src = (img && img.getAttribute("src")) || "";
		return (
			/\/assets\/globals\/missing\//.test(src) ||
			(img && img.classList.contains("is-moderation_censored"))
		);
	};
	const needsHistoryFix = (el) => {
		const info = getHistoryInfo(el);
		if (!info) return false;
		const img = el.querySelector("img");
		if (!img) return false;
		const malType = info.kind === "anime" ? "anime" : "manga";
		// Чиним, если обложка-плейсхолдер/цензура ИЛИ тайтл в списке удалённых.
		if (!coverMissing(img) && !isKnownDeleted(info.id, malType)) return false;
		const k = posterEntryKey(info);
		if (el.dataset.malPosterResolved === k) return false;
		if (el.dataset.malPosterBusy === k) return false;
		return true;
	};
	const applyHistoryPoster = (el, pic) => {
		if (!pic) return;
		const img = el.querySelector("img");
		if (!img) return;
		img.src = pic.medium;
		img.srcset = `${pic.large} 2x, ${pic.medium} 1x`;
		img.classList.remove("is-moderation_censored");
		img.style.filter = "none";
		const picture = img.closest("picture");
		if (picture) picture.querySelectorAll("source").forEach((s) => s.remove());
	};

	const needsPosterFix = (el) =>
		needsGridPosterFix(el) || needsLineListFix(el) || needsHistoryFix(el);

	const isNearViewport = (el) => {
		const r = el.getBoundingClientRect();
		const m = POSTER_VIEW_MARGIN;
		return (
			r.bottom > -m &&
			r.top < window.innerHeight + m &&
			r.right > -m &&
			r.left < window.innerWidth + m
		);
	};

	// --- очередь/обсёрверы постеров ---
	let posterIo = null;
	const posterMos = [];
	let posterKickTimer = 0;
	let posterScrollAttached = false;
	const posterQueue = [];
	const posterQueued = new WeakSet();
	let posterDraining = false;

	const enqueuePosterRow = (el) => {
		if (!needsPosterFix(el)) return;
		if (posterQueued.has(el)) return;
		posterQueued.add(el);
		posterQueue.push(el);
		void drainPosterQueue();
	};
	const drainPosterQueue = async () => {
		if (posterDraining) return;
		posterDraining = true;
		try {
			while (posterQueue.length) {
				const batch = posterQueue.splice(0, POSTER_BATCH);
				for (const a of batch) posterQueued.delete(a);
				await Promise.all(batch.map((a) => processPosterRowSafe(a)));
			}
		} finally {
			posterDraining = false;
			if (posterQueue.length) void drainPosterQueue();
		}
	};
	const processPosterRowSafe = async (el) => {
		if (el.matches(".c-history .entry") && needsHistoryFix(el)) {
			const info = getHistoryInfo(el);
			if (!info) return;
			const k = posterEntryKey(info);
			el.dataset.malPosterBusy = k;
			try {
				const pic = await fetchPosterPic(info.id, info.kind);
				if (pic) applyHistoryPoster(el, pic);
				el.dataset.malPosterResolved = k;
			} finally {
				if (el.dataset.malPosterBusy === k) delete el.dataset.malPosterBusy;
			}
			return;
		}
		if (el.matches("tr.user_rate") && needsLineListFix(el)) {
			const info = getLineListEntryInfo(el);
			if (!info) return;
			const k = posterEntryKey(info);
			el.dataset.malPosterBusy = k;
			try {
				const pic = await fetchPosterPic(info.id, info.kind);
				const cur = getLineListEntryInfo(el);
				if (cur && posterEntryKey(cur) === k && pic) applyLineListPoster(el, pic);
				if (cur && posterEntryKey(cur) === k) el.dataset.malPosterResolved = k;
			} finally {
				if (el.dataset.malPosterBusy === k) delete el.dataset.malPosterBusy;
			}
			return;
		}
		const info = getGridEntryInfo(el);
		if (!info || !needsGridPosterFix(el)) return;
		const k = posterEntryKey(info);
		el.dataset.malPosterBusy = k;
		try {
			const pic = await fetchPosterPic(info.id, info.kind);
			const cur = getGridEntryInfo(el);
			if (!cur || posterEntryKey(cur) !== k) return;
			const img = el.querySelector(".image-cutter img");
			if (img && POSTER_MISSING_CATALOG_RE.test(img.getAttribute("src") || "") && pic)
				applyCatalogPoster(el, pic);
			el.dataset.malPosterResolved = k;
		} finally {
			if (el.dataset.malPosterBusy === k) delete el.dataset.malPosterBusy;
		}
	};

	const observePosterRow = (el) => {
		if (!posterIo) return;
		const ok =
			el.matches("article.b-catalog_entry.c-anime") ||
			el.matches("article.b-catalog_entry.c-manga") ||
			(el.matches(".c-column.user_rate") && el.closest(".list-posters")) ||
			el.matches(".c-history .entry") ||
			(el.matches("tr.user_rate") &&
				el.closest("table.list-lines") &&
				isUserListLinesPage());
		if (!ok) return;
		try {
			posterIo.observe(el);
		} catch (e) {
			/* уже наблюдается */
		}
	};
	const wireAllPosterRows = () => {
		document
			.querySelectorAll(
				".cc-entries article.b-catalog_entry.c-anime, .cc-entries article.b-catalog_entry.c-manga",
			)
			.forEach(observePosterRow);
		document
			.querySelectorAll(".list-posters .c-column.user_rate")
			.forEach(observePosterRow);
		document.querySelectorAll(".c-history .entry").forEach(observePosterRow);
		if (isUserListLinesPage())
			document
				.querySelectorAll("table.b-table.list-lines tbody.entries tr.user_rate")
				.forEach(observePosterRow);
	};
	const kickPosterInView = () => {
		document
			.querySelectorAll(
				".cc-entries article.b-catalog_entry.c-anime, .cc-entries article.b-catalog_entry.c-manga",
			)
			.forEach((el) => {
				if (needsGridPosterFix(el) && isNearViewport(el)) enqueuePosterRow(el);
			});
		document
			.querySelectorAll(".list-posters .c-column.user_rate")
			.forEach((el) => {
				if (needsGridPosterFix(el) && isNearViewport(el)) enqueuePosterRow(el);
			});
		document.querySelectorAll(".c-history .entry").forEach((el) => {
			if (needsHistoryFix(el) && isNearViewport(el)) enqueuePosterRow(el);
		});
		if (isUserListLinesPage())
			document
				.querySelectorAll("table.b-table.list-lines tbody.entries tr.user_rate")
				.forEach((tr) => {
					if (needsLineListFix(tr) && isNearViewport(tr)) enqueuePosterRow(tr);
				});
	};
	const schedulePosterKick = () => {
		clearTimeout(posterKickTimer);
		posterKickTimer = setTimeout(() => {
			wireAllPosterRows();
			kickPosterInView();
		}, 60);
	};
	const teardownPosterEnhancements = () => {
		if (posterScrollAttached) {
			window.removeEventListener("scroll", schedulePosterKick, { capture: true });
			posterScrollAttached = false;
		}
		if (posterIo) {
			posterIo.disconnect();
			posterIo = null;
		}
		while (posterMos.length) posterMos.pop().disconnect();
		clearTimeout(posterKickTimer);
		posterQueue.length = 0;
	};

	// Постер на детальной странице (живой тайтл с вырезанной обложкой).
	let posterDetailRunning = false;
	const tryFixDetailPoster = async () => {
		if (posterDetailRunning) return;
		const m =
			location.pathname.match(/^\/(animes|mangas|ranobe)\/(\d+)/) || null;
		if (!m) return;
		const poster = document.querySelector(".c-poster");
		if (!poster) return;
		const img = poster.querySelector("img");
		if (!img || !POSTER_MISSING_MAIN_RE.test(img.getAttribute("src") || "")) return;
		const kind =
			m[1] === "animes" ? "anime" : m[1] === "mangas" ? "manga" : "ranobe";
		posterDetailRunning = true;
		try {
			const pic = await fetchPosterPic(m[2], kind);
			applyDetailPoster(poster, pic);
		} finally {
			posterDetailRunning = false;
		}
	};

	const setupPosterEnhancements = () => {
		tryFixDetailPoster();
		const moRoots = [];
		const cc = document.querySelector(".cc-entries");
		if (cc) moRoots.push(cc);
		document.querySelectorAll(".list-posters").forEach((lp) => moRoots.push(lp));
		document.querySelectorAll(".c-history").forEach((h) => moRoots.push(h));
		if (isUserListLinesPage())
			document
				.querySelectorAll("table.b-table.list-lines tbody.entries")
				.forEach((tb) => moRoots.push(tb));
		if (!moRoots.length) return;

		posterIo = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					if (needsPosterFix(e.target)) enqueuePosterRow(e.target);
				}
			},
			{
				root: null,
				rootMargin: `${POSTER_VIEW_MARGIN}px 0px ${POSTER_VIEW_MARGIN}px 0px`,
				threshold: 0,
			},
		);
		wireAllPosterRows();
		kickPosterInView();

		const moOpts = {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["id", "src", "srcset", "data-target_id", "href"],
		};
		for (const root of moRoots) {
			const mo = new MutationObserver(schedulePosterKick);
			mo.observe(root, moOpts);
			posterMos.push(mo);
		}
		window.addEventListener("scroll", schedulePosterKick, {
			capture: true,
			passive: true,
		});
		posterScrollAttached = true;
	};

	const onPosterNav = () => {
		teardownPosterEnhancements();
		setupPosterEnhancements();
	};

	// Постер во всплывающей карточке (hover-tooltip ".b-catalog_entry-tooltip").
	// У 18+ постер помечен классом is-moderation_censored (CSS-блюр). Чиним устойчиво:
	// 1) снимаем блюр у картинки И всех родителей до тултипа (filter:none !important),
	// 2) заменяем постер на Jikan (гарантия, если блюр запечён в файле или на родителе).
	const fixCensoredImg = (img) => {
		if (!img || img.dataset.fix404Poster) return;
		img.dataset.fix404Poster = "1";

		const tip = img.closest(".b-catalog_entry-tooltip");

		// Снимаем CSS-блюр у картинки и предков (вплоть до контейнера тултипа).
		let el = img;
		for (let i = 0; el && i < 6; i++) {
			if (el.classList) el.classList.remove("is-moderation_censored");
			if (el.style && el.style.setProperty)
				el.style.setProperty("filter", "none", "important");
			if (el === tip || el === document.body) break;
			el = el.parentElement;
		}

		// Заменяем постер на чистый с Jikan (по ссылке на тайтл из карточки).
		const scope = tip || img.parentElement || img;
		const link =
			(scope.querySelector &&
				scope.querySelector(
					'a.image-link[href], a[href*="/animes/"], a[href*="/mangas/"], a[href*="/ranobe/"]',
				)) ||
			img.closest("a[href]");
		const href = (link && link.getAttribute("href")) || "";
		const m = href.match(/\/(animes|mangas|ranobe)\/(\d+)/);
		if (!m) return;
		const kind =
			m[1] === "animes" ? "anime" : m[1] === "mangas" ? "manga" : "ranobe";
		fetchPosterPic(m[2], kind).then((pic) => {
			if (!pic) return;
			img.src = pic.medium;
			img.srcset = `${pic.large} 2x, ${pic.medium} 1x`;
			img.removeAttribute("data-src");
			// <source> в <picture> может перекрыть наш src -> убираем.
			const pic2 = img.closest("picture");
			if (pic2) pic2.querySelectorAll("source").forEach((s) => s.remove());
		});
	};

	// Сканируем поддерево на цензур-картинки и плейсхолдеры внутри тултипов.
	const scanForCensored = (root) => {
		if (!root || root.nodeType !== 1) return;
		if (root.matches && root.matches("img.is-moderation_censored")) {
			fixCensoredImg(root);
		}
		if (!root.querySelectorAll) return;
		root.querySelectorAll("img.is-moderation_censored").forEach(fixCensoredImg);
		root.querySelectorAll(".b-catalog_entry-tooltip img").forEach((im) => {
			const s = im.getAttribute("src") || "";
			if (POSTER_MISSING_MAIN_RE.test(s) || POSTER_MISSING_CATALOG_RE.test(s))
				fixCensoredImg(im);
		});
	};

	let tooltipObserver = null;
	const setupTooltipPosterFix = () => {
		try {
			// Пере-навешиваем на актуальный body (после document.write он новый).
			if (tooltipObserver) tooltipObserver.disconnect();
			// На случай, если тултип-контейнер переиспользуется: ловим ДОБАВЛЕНИЕ
			// самих картинок (новый img появляется при заполнении тултипа).
			tooltipObserver = new MutationObserver((muts) => {
				for (const mut of muts) {
					for (const node of mut.addedNodes) scanForCensored(node);
				}
			});
			tooltipObserver.observe(document.body, {
				childList: true,
				subtree: true,
			});
			scanForCensored(document.body); // вдруг уже есть в DOM
		} catch (e) {
			debug("tooltip observer fail", e);
		}
	};

	// =====================================================================
	// ВОССТАНОВЛЕНИЕ ПОИСКА по удалённым (18+) тайтлам.
	// Нативный автокомплит прячет censored-контент. Шлём параллельный GraphQL
	// с censored:false и подмешиваем удалённые результаты в выпадашку поиска.
	// =====================================================================
	const SEARCH_DEBOUNCE_MS = 300;
	const SEARCH_FETCH_LIMIT = 8;
	const SEARCH_SHOW_LIMIT = 6;
	const SEARCH_KIND_MAP = {
		tv: "TV Сериал", movie: "Фильм", ova: "OVA", ona: "ONA",
		special: "Спецвыпуск", tv_special: "TV Спецвыпуск", music: "Клип",
		manga: "Манга", manhwa: "Манхва", manhua: "Маньхуа", novel: "Ранобэ",
		one_shot: "Ваншот", doujin: "Додзинси",
	};
	const SEARCH_STATUS_MAP = {
		released: "вышло", ongoing: "онгоинг", anons: "анонс",
		paused: "приостановлено", discontinued: "прекращено",
	};
	const searchQuery = (root, extra) =>
		`query($s:String){ ${root}(search:$s, limit:${SEARCH_FETCH_LIMIT}, censored:false${extra || ""}){ id name russian english synonyms url kind status airedOn{year} ${root === "animes" ? "studios{name}" : "publishers{name}"} genres{id name russian} poster{miniUrl mainUrl} } }`;
	const SEARCH_Q_ANIME = searchQuery("animes");
	const SEARCH_Q_MANGA = searchQuery("mangas");

	let __searchAbort = null;
	let __searchCachedHTML = "";

	const searchGraphQL = async (query, term, signal) => {
		const res = await fetch("/api/graphql", {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ query, variables: { s: term } }),
			signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()).data || {};
	};

	// Постер для результата поиска (у 18+ poster:null -> строим по шаблону /system).
	const searchPoster = (item, seg) => {
		if (item.poster && item.poster.miniUrl)
			return {
				mini: item.poster.miniUrl,
				main: item.poster.mainUrl || item.poster.miniUrl,
			};
		return {
			mini: `/system/${seg}/x48/${item.id}.jpg`,
			main: `/system/${seg}/x96/${item.id}.jpg`,
		};
	};

	const searchRelevance = (item, termLower) => {
		let score = 0;
		const titles = [
			(item.russian || "").toLowerCase(),
			(item.name || "").toLowerCase(),
			(item.english || "").toLowerCase(),
			...(item.synonyms || []).map((s) => s.toLowerCase()),
		];
		for (const t of titles) {
			if (!t) continue;
			if (t === termLower) score += 20;
			else if (t.startsWith(termLower)) score += 12;
			else if (t.includes(termLower)) score += 8;
		}
		return score;
	};

	const buildSearchItem = (item, kind) => {
		const seg = kind === "anime" ? "animes" : "mangas";
		const titleRu = item.russian || item.name || item.english || "???";
		const url = item.url || `/${seg}/${item.id}`;
		const pic = searchPoster(item, seg);
		const isAnime = kind === "anime";
		const kindLabel = SEARCH_KIND_MAP[item.kind] || (isAnime ? item.kind : "Манга");
		const year = item.airedOn?.year ? `${item.airedOn.year} год` : "";
		const org = (isAnime ? item.studios : item.publishers)?.[0]?.name || "";
		const statusLabel =
			!isAnime && item.status === "released"
				? "издано"
				: SEARCH_STATUS_MAP[item.status] || item.status || "";
		const genresHtml = (item.genres || [])
			.slice(0, 3)
			.map(
				(g) =>
					`<div class="b-tag" data-href="/${seg}/genre/${g.id}-${g.name}"><span class="genre-en">${g.name}</span><span class="genre-ru">${g.russian}</span></div>`,
			)
			.join("");
		let metaLine = `<div class="b-tag">${kindLabel}</div>`;
		if (year) metaLine += `<div class="b-tag">${year}</div>`;
		if (org)
			metaLine += `<div class="b-anime_status_tag studio" data-text="${org}" title="${org}"></div>`;
		if (statusLabel)
			metaLine += `<div class="b-anime_status_tag released" data-text="${statusLabel}"></div>`;
		return `
		<a class="b-db_entry-variant-list_item" data-id="${item.id}" data-type="${kind}" href="${url}" data-adv="true">
			<div class="image"><img src="${pic.mini}" srcset="${pic.main} 2x" alt="${titleRu}" onerror="this.onerror=null;this.removeAttribute('srcset');this.src='/assets/globals/missing_mini.png';"></div>
			<div class="info">
				<div class="name"><span class="b-link">${titleRu}<span class="b-separator inline">/</span>${item.name}</span></div>
				<div class="line"><div class="key">Тип:</div><div class="value">${metaLine}</div></div>
				${genresHtml ? `<div class="line"><div class="key">Жанры:</div><div class="value">${genresHtml}</div></div>` : ""}
			</div>
		</a>`;
	};

	const renderSearchResults = (inner) => {
		let wrapper = inner.querySelector("#adv-search-wrapper");
		if (!__searchCachedHTML) {
			if (wrapper) wrapper.remove();
			return;
		}
		if (!wrapper) {
			wrapper = document.createElement("div");
			wrapper.id = "adv-search-wrapper";
			inner.prepend(wrapper);
		}
		if (wrapper.innerHTML !== __searchCachedHTML)
			wrapper.innerHTML = __searchCachedHTML;
	};

	const performDeletedSearch = async (inner, input) => {
		const term = input.value.trim();
		if (term.length < 2) {
			__searchCachedHTML = "";
			renderSearchResults(inner);
			return;
		}
		if (__searchAbort) __searchAbort.abort();
		__searchAbort = new AbortController();
		const signal = __searchAbort.signal;

		let anime = [];
		let manga = [];
		try {
			const [a, m] = await Promise.all([
				searchGraphQL(SEARCH_Q_ANIME, term, signal).catch(() => ({})),
				searchGraphQL(SEARCH_Q_MANGA, term, signal).catch(() => ({})),
			]);
			anime = a.animes || [];
			manga = m.mangas || [];
		} catch (e) {
			if (e.name === "AbortError") return;
			return;
		}

		// Дедуп против НАТИВНЫХ результатов (чтобы не дублировать уже показанное).
		const nativeIds = new Set(
			Array.from(
				inner.querySelectorAll(
					".b-db_entry-variant-list_item[data-id]:not([data-adv])",
				),
			).map((el) => `${el.dataset.type || ""}:${el.dataset.id}`),
		);
		const termLower = term.toLowerCase();
		const tagged = [
			...anime.map((it) => ({ it, kind: "anime" })),
			...manga.map((it) => ({ it, kind: "manga" })),
		].filter(({ it, kind }) => !nativeIds.has(`${kind}:${it.id}`));
		tagged.sort(
			(x, y) => searchRelevance(y.it, termLower) - searchRelevance(x.it, termLower),
		);
		const top = tagged.slice(0, SEARCH_SHOW_LIMIT);
		if (!top.length) {
			__searchCachedHTML = "";
			renderSearchResults(inner);
			return;
		}
		__searchCachedHTML = `<div class="adv-results-group">${top
			.map(({ it, kind }) => buildSearchItem(it, kind))
			.join("")}</div><div class="adv-separator" style="height:1px;border-bottom:1px dashed rgba(127,127,127,0.25);margin:6px 0 10px;"></div>`;
		renderSearchResults(inner);
	};

	const attachSearchListener = (inner, input) => {
		if (inner.dataset.advAttached === "true") return;
		inner.dataset.advAttached = "true";
		let t;
		input.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => performDeletedSearch(inner, input), SEARCH_DEBOUNCE_MS);
		});
		const obs = new MutationObserver(() => renderSearchResults(inner));
		obs.observe(inner, { childList: true });
	};

	let searchSetupObserver = null;
	const setupDeletedSearch = () => {
		const tryAttach = () => {
			const gs = document.querySelector(".global-search");
			if (!gs) return;
			const input = gs.querySelector("input");
			const inner = gs.querySelector(".search-results .inner");
			if (input && inner) attachSearchListener(inner, input);
		};
		tryAttach();
		try {
			if (searchSetupObserver) searchSetupObserver.disconnect();
			searchSetupObserver = new MutationObserver(tryAttach);
			searchSetupObserver.observe(document.body, { childList: true, subtree: true });
		} catch (e) {
			debug("search observer fail", e);
		}
	};

	// ================================
	// ОБРАБОТЧИКИ ДЛЯ TURBOLINKS/PJAX
	// ================================

	// Защита от повторного восстановления одного и того же URL.
	let __lastHandledHref = "";

	// Восстанавливаем только страницы аниме/манги/ранобэ.
	const isRestorableRoute = (pathname) =>
		/^\/(animes|mangas|ranobe)\/[a-z0-9-]+/i.test(pathname);

	// Голая 404-страница Shikimori: <title>404</title> и <p class="error-404"> в .dialog.
	// Маркер .error-404 надёжнее заголовка: он есть в DOM сразу после подмены <body>,
	// независимо от того, успел ли обновиться document.title.
	const isShiki404 = () =>
		!!document.querySelector(".dialog .error-404") ||
		/^404(\s|$)/i.test(document.title.trim());

	// Единая точка входа: проверяет, что это 404 на нужном роуте, и запускает init
	// не чаще одного раза на URL (init() сам сделает document.write).
	const handleNavigation = () => {
		if (!isRestorableRoute(window.location.pathname)) return;
		if (!isShiki404()) {
			// Ушли с 404 (например, обычная навигация) — снимаем блокировку,
			// чтобы повторный заход на тот же удалённый URL снова сработал.
			__lastHandledHref = "";
			return;
		}
		const href = window.location.href;
		if (__lastHandledHref === href) return;
		__lastHandledHref = href;
		init();
	};

	// ----- Именованные глобальные обработчики -----
	// ВАЖНО: при восстановлении мы делаем document.write, а он удаляет слушатели
	// и с document, И с window. Поэтому attachGlobalHandlers() вызывается ДВАЖДЫ:
	// в точке входа и сразу после document.write (см. renderEntityPage). Именованные
	// функции -> повторный addEventListener НЕ плодит дубли (дедуп по type+fn+capture).

	let __hoverTimer = null;
	let __hoverHref = "";
	const linkFrom = (e) =>
		e.target && e.target.closest ? e.target.closest("a[href]") : null;

	// ПРЕФЕТЧ (hover + mousedown): греем GraphQL заранее, в т.ч. для "Похожее"/"Связанное".
	const onLinkHover = (e) => {
		const a = linkFrom(e);
		if (!a) return;
		const href = a.getAttribute("href");
		if (!href || href === __hoverHref || !parseEntityLink(href)) return;
		__hoverHref = href;
		clearTimeout(__hoverTimer);
		__hoverTimer = setTimeout(() => prefetchFromHref(href), 80);
	};
	const onLinkHoverOut = (e) => {
		const a = linkFrom(e);
		if (a && a.getAttribute("href") === __hoverHref) {
			clearTimeout(__hoverTimer);
			__hoverHref = "";
		}
	};
	const onLinkMouseDown = (e) => {
		const a = linkFrom(e);
		if (a) prefetchFromHref(a.getAttribute("href") || "");
	};

	// ПЕРЕХВАТ КЛИКА по известным удалённым ссылкам — чтобы 404 не мелькала.
	const onLinkClick = (e) => {
		if (!CONFIG.INTERCEPT_KNOWN_DELETED) return;
		if (
			e.defaultPrevented ||
			e.button !== 0 ||
			e.metaKey ||
			e.ctrlKey ||
			e.shiftKey ||
			e.altKey
		)
			return;
		const a = linkFrom(e);
		if (!a || a.target === "_blank") return;
		const href = a.getAttribute("href");
		const parsed = parseEntityLink(href);
		if (!parsed || !isKnownDeleted(parsed.id, parsed.type)) return;

		e.preventDefault();
		e.stopImmediatePropagation();
		const absUrl = new URL(href, location.origin).href;
		try {
			history.pushState({ fix404: true }, "", absUrl);
		} catch (err) {
			debug("pushState не удался", err);
		}
		__lastHandledHref = location.href;
		log(`🚀 Перехват клика: ${parsed.displayType} ${parsed.id} (без мелькания 404)`);
		if (typeof showLoader === "function") showLoader();
		renderEntityPage(parsed.id, parsed.type, parsed.displayType);
	};

	// MutationObserver для Turbolinks "error render" (404 на месте, без turbolinks:load).
	let navObserver = null;

	// Навешивает ВСЕ глобальные слушатели/наблюдатели. Идемпотентно (именованные fn),
	// поэтому безопасно вызывать повторно после document.write.
	const attachGlobalHandlers = () => {
		document.addEventListener("page:load", handleNavigation);
		document.addEventListener("turbolinks:load", handleNavigation);

		document.addEventListener("mouseover", onLinkHover);
		document.addEventListener("mouseout", onLinkHoverOut);
		document.addEventListener("mousedown", onLinkMouseDown, true);
		document.addEventListener("click", onLinkClick, true);

		installPopstateGuard();

		document.addEventListener("turbolinks:load", onPosterNav);
		document.addEventListener("turbo:load", onPosterNav);
		onPosterNav();

		setupTooltipPosterFix();

		// Восстановление поиска по удалённым тайтлам (глобальный поиск shikimori).
		setupDeletedSearch();

		// navObserver пере-навешиваем на АКТУАЛЬНЫЙ documentElement (после write он новый).
		try {
			if (navObserver) navObserver.disconnect();
			navObserver = new MutationObserver(handleNavigation);
			navObserver.observe(document.documentElement, { childList: true });
		} catch (e) {
			console.error("[404FIX] Не удалось запустить MutationObserver:", e);
		}
	};
	// делаем доступным для повторного вызова после восстановления (document.write).
	__attachGlobalHandlers = attachGlobalHandlers;

	// Подгружаем список удалённых тайтлов в фоне (не блокирует работу).
	loadDeletedIds();

	// Навешиваем всё.
	attachGlobalHandlers();

	// делаем доступным из консоли
	window.init = init;

	// debug-алиас
	window.debugInit = (url) => init(url, { force: true });

	// Запуск при обычной (жёсткой) загрузке страницы / F5.
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", handleNavigation);
	} else {
		// Если страница уже загружена
		handleNavigation();
	}
})();
