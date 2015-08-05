/* global Zepto:true */
/*
 * 路由器
 * 1. 为什么要自己记录历史，而不是通过 history.pushState 存？ 因为 DOM 无法通过 history.pushState 存
 */
+function ($) {
  "use strict";

  if (!window.CustomEvent) {
    window.CustomEvent = function (type, config) {
      var e = document.createEvent('CustomEvent');
      e.initCustomEvent(type, config.bubbles, config.cancelable, config.detail, config.id);
      return e;
    };
  }

  var Router = function() {
    this.state = sessionStorage;
    this.state.setItem("stateid", parseInt(this.state.getItem("stateid") || 1)+1);
    this.state.setItem("currentStateID", this.state.getItem("stateid"));
    this.stack = sessionStorage;
    this.stack.setItem("back", "[]");  //返回栈, {url, pageid, stateid}
    this.stack.setItem("forward", "[]");  //返回栈, {url, pageid, stateid}
    this.init();
    this.xhr = null;
  }

  Router.prototype.defaults = {
  };

  Router.prototype.init = function() {
    var currentPage = this.getCurrentPage();
    if(!currentPage[0]) currentPage = $(".page").eq(0).addClass("page-current");
    var hash = location.hash;
    if(currentPage[0] && !currentPage[0].id) currentPage[0].id = (hash ? hash.slice(1) : this.genRandomID());

    if(!currentPage[0]) throw new Error("can't find .page element");
    var newCurrentPage = $(hash); 


    if(newCurrentPage[0] && (!currentPage[0] || hash.slice(1) !== currentPage[0].id)) {
      currentPage.removeClass("page-current");
      newCurrentPage.addClass("page-current");
      currentPage = newCurrentPage;
    }

    //第一次打开的时候需要pushstate，这样会导致多次刷新出现很多重复历史，但是不这么做，刷新之后第一次加载新页面会无法后退
    this.state.setItem("first-init", 1)
    var id = this.genStateID();
    this.pushState(location.href, id);
    this.pushBack({
      url: location.href,
      pageid: currentPage[0].id,
      id: id
    });
    this.setCurrentStateID(id);

    window.addEventListener('popstate', $.proxy(this.onpopstate, this));
  }

  //加载一个页面,传入的参数是页面id或者url
  Router.prototype.loadPage = function(url) {

    this.getPage(url, function(page) {

      var pageid = this.getCurrentPage()[0].id;
      this.pushBack({
        url: url,
        pageid: "#"+ pageid,
        id: this.getCurrentStateID()
      });

      //删除全部forward
      var forward = JSON.parse(this.state.getItem("forward") || "[]");
      for(var i=0;i<forward.length;i++) {
        $(forward[i].pageid).remove();
      page}
      this.state.setItem("forward", "[]");  //clearforward

      page.insertAfter($(".page")[0]);
      this.animatePages(this.getCurrentPage(), page);

      var id = this.genStateID();
      this.setCurrentStateID(id);

      this.pushState(url, id);

      this.forwardStack  = [];  //clear forward stack

    });
  }

  Router.prototype.animatePages = function (leftPage, rightPage, leftToRight) {
    var removeClasses = 'page-left page-right page-current page-from-center-to-left page-from-center-to-right page-from-right-to-center page-from-left-to-center';
    this.dispatch("pageAnimationStart");
    var self = this;
    if (!leftToRight) {
      leftPage.removeClass(removeClasses).addClass('page-from-center-to-left');
      rightPage.removeClass(removeClasses).addClass('page-from-right-to-center');
      leftPage.animationEnd(function() {
        leftPage.removeClass(removeClasses);
      });
      rightPage.animationEnd(function() {
        rightPage.removeClass(removeClasses).addClass("page-current");
        self.dispatch("pageAnimationEnd");
        rightPage.trigger("pageInitInternal", [rightPage[0].id, rightPage]);
        rightPage.trigger("pageInit", [rightPage[0].id, rightPage]);
      });
    } else {
      leftPage.removeClass(removeClasses).addClass('page-from-left-to-center');
      rightPage.removeClass(removeClasses).addClass('page-from-center-to-right');
      leftPage.animationEnd(function() {
        leftPage.removeClass(removeClasses).addClass("page-current");
        self.dispatch("pageAnimationEnd");
        rightPage.trigger("pageInitInternal", [rightPage[0].id, rightPage]);
        leftPage.trigger("pageInit", [leftPage[0].id, leftPage]);
      });
      rightPage.animationEnd(function() {
        rightPage.removeClass(removeClasses);
      });
    }

  }
  Router.prototype.getCurrentPage = function () {
    return $(".page-current");
  }
  //如果无法前进，则加载对应的url
  Router.prototype.forward = function(url) {
    var stack = JSON.parse(this.stack.getItem("forward"));
    if(stack.length) {
      history.forward();
    } else {
      location.href = url;
    }
  }
  //如果无法后退，则加载对应的url
  Router.prototype.back = function(url) {
    var stack = JSON.parse(this.stack.getItem("back"));
    if(stack.length) {
      history.back();
    } else {
      location.href = url;
    }
  }

  //后退
  Router.prototype._back = function() {
    var h = this.popBack();
    var currentPage = this.getCurrentPage();
    var newPage = $(h.pageid);
    if(!newPage[0]) return;
    this.pushForward({url: location.href, pageid: "#"+currentPage[0].id, id: this.getCurrentStateID()});
    this.animatePages(newPage, currentPage, true);
    this.setCurrentStateID(h.id);
  }

  //前进
  Router.prototype._forward = function() {
    var h = this.popForward();
    var currentPage = this.getCurrentPage();
    var newPage = $(h.pageid);
    if(!newPage[0]) return;
    this.pushBack({url: location.href, pageid: "#"+currentPage[0].id, id: this.getCurrentStateID()});
    this.animatePages(currentPage, newPage);
    this.setCurrentStateID(h.id);
  }

  Router.prototype.pushState = function(url, id) {
    history.pushState({url: url, id: id}, '', url);
  }

  Router.prototype.onpopstate = function(d) {
    var state = d.state;
    if(!state) {//刷新再后退导致无法取到state
      location.reload();
      return false;
    }

    if(state.id === this.getCurrentStateID()) {
      return false;
    }
    var forward = state.id > this.getCurrentStateID();
    if(forward) this._forward();
    else this._back();
  }


  //根据url获取页面的DOM，如果是一个内联页面，则直接返回，否则用ajax加载
  Router.prototype.getPage = function(url, callback) {
    if(url.startsWith("#")) return callback.apply(this, [$(url)]);

    this.dispatch("pageLoadStart");

    if(this.xhr && this.xhr.readyState < 4) {
      xhr.onreadystatechange = noop;
      xhr.abort();
      this.dispatch("pageLoadCancel");
    }

    var self = this;

    this.xhr = $.ajax({
      url: url,
      success: $.proxy(function(data, s, xhr) {
        var $page = this.parseXHR(xhr);
        if(!$page[0].id) $page[0].id = this.genRandomID();
        callback.apply(this, [$page]);
      }, this),
      error: function() {
        self.dispatch("pageLoadError");
      },
      complete: function() {
        self.dispatch("pageLoadComplete");
      }
    });
  }
  Router.prototype.parseXHR = function(xhr) {
    var response = xhr.responseText;
    var html  = response.match(/<body[^>]*>([\s\S.]*)<\/body>/i)[1];
    if(!html) html = response;
    html = "<div>"+html+"</div>";
    var tmp = $(html);

    tmp.find(".popup, .panel, .panel-overlay").appendTo(document.body);

    var $page = tmp.find(".page");
    if(!$page[0]) $page = tmp.addClass("page");
    return $page;
  }

  Router.prototype.genStateID = function() {
    var id = parseInt(this.state.getItem("stateid")) + 1;
    this.state.setItem("stateid", id);
    return id;
  }
  Router.prototype.getCurrentStateID = function() {
    return parseInt(this.state.getItem("currentStateID"));
  }
  Router.prototype.setCurrentStateID = function(id) {
    this.state.setItem("currentStateID", id);
  }
  Router.prototype.genRandomID = function() {
    return "page-"+(+new Date());
  }

  Router.prototype.popBack = function() {
    var stack = JSON.parse(this.stack.getItem("back"));
    if(!stack.length) return null;
    var h = stack.splice(stack.length-1, 1)[0];
    this.stack.setItem("back", JSON.stringify(stack));
    return h;
  }
  Router.prototype.pushBack = function(h) {
    var stack = JSON.parse(this.stack.getItem("back"));
    stack.push(h);
    this.stack.setItem("back", JSON.stringify(stack));
  }
  Router.prototype.popForward = function() {
    var stack = JSON.parse(this.stack.getItem("forward"));
    if(!stack.length) return null;
    var h = stack.splice(stack.length-1, 1)[0];
    this.stack.setItem("forward", JSON.stringify(stack));
    return h;
  }
  Router.prototype.pushForward = function(h) {
    var stack = JSON.parse(this.stack.getItem("forward"));
    stack.push(h);
    this.stack.setItem("forward", JSON.stringify(stack));
  }

  Router.prototype.dispatch = function (event) {
    var e = new CustomEvent(event, {
      bubbles: true,
      cancelable: true
    });

    window.dispatchEvent(e);
  };

  $(function() {
    var router = new Router();
    $(document).on("click", "a", function(e) {
      var $target = $(e.currentTarget);
      if($target.hasClass("external") ||
         $target[0].hasAttribute("external") ||
         $target.hasClass("tab-link") ||
         $target.hasClass("open-popup") ||
         $target.hasClass("open-panel")
        ) return;
      e.preventDefault();
      var url = $target.attr("href");
      if($target.hasClass("back")) {
        router.back(url);
        return;
      }

      if(!url || url === "#") return;
      router.loadPage(url);
    })
  });
}(Zepto);